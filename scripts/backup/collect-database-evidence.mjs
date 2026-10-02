import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SERVICE_NAME = process.env.PGSERVICE ?? "terroir_backup";
const SNAPSHOT_ID = process.env.BACKUP_SNAPSHOT_ID;

function snapshotSql(sql, snapshotId) {
  if (!snapshotId) return sql;
  if (!/^[0-9A-Fa-f-]+$/u.test(snapshotId)) {
    throw new Error("BACKUP_SNAPSHOT_ID has an invalid format.");
  }
  return `begin isolation level repeatable read read only;
set transaction snapshot '${snapshotId}';
${sql};
commit`;
}

export function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function parseSequenceState(state, schema, sequence) {
  const [lastValue, isCalled] = state.split("\t");
  if (
    !/^-?\d+$/u.test(lastValue) ||
    !["true", "false"].includes(isCalled)
  ) {
    throw new Error(`Invalid sequence state for ${schema}.${sequence}.`);
  }
  return {
    schema,
    sequence,
    last_value: lastValue,
    is_called: isCalled === "true",
  };
}

// Restore containers have no network. Keep their queries separate from the
// production backup's service-file connection and exported snapshot.
export function evidenceQueryCommand(sql, { container } = {}) {
  if (container !== undefined && !/^terroir-restore-drill-[0-9]+$/u.test(container)) {
    throw new Error("Evidence queries require the drill's disposable container name.");
  }
  const options = ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c"];
  if (container !== undefined) {
    return {
      command: "docker",
      args: ["exec", container, "psql", "-U", "supabase_admin", "-d", "postgres",
        ...options, sql],
    };
  }
  return {
    command: "psql",
    args: [`service=${SERVICE_NAME}`, ...options, snapshotSql(sql, SNAPSHOT_ID)],
  };
}

function psql(sql, transport) {
  const { command, args } = evidenceQueryCommand(sql, transport);
  const result = spawnSync(
    command,
    args,
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(
      `Database evidence query failed: ${result.stderr.trim()}`,
    );
  }
  return result.stdout.trim();
}

function listTables(transport) {
  const output = psql(
    `select n.nspname || E'\\t' || c.relname
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r'
       and n.nspname <> 'information_schema'
       and n.nspname !~ '^pg_'
       and not exists (
         select 1
         from pg_catalog.pg_depend d
         where d.classid = 'pg_catalog.pg_class'::regclass
           and d.objid = c.oid
           and d.deptype = 'e'
       )
     order by n.nspname collate "C", c.relname collate "C"`, transport,
  );
  if (!output) return [];
  return output.split("\n").map((line) => {
    const [schema, table] = line.split("\t");
    if (!schema || !table) {
      throw new Error("Database table inventory returned a malformed row.");
    }
    return { schema, table };
  });
}

function exactRowCount({ schema, table }, transport) {
  const relation = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const output = psql(`select count(*)::text from ${relation}`, transport);
  const count = Number(output);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid row count for ${schema}.${table}.`);
  }
  return count;
}

function deterministicChecksum({ schema, table }, transport) {
  const relation = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const { command, args } = evidenceQueryCommand(`copy (
    select pg_catalog.to_jsonb(row_value)::text
    from ${relation} as row_value
    order by pg_catalog.to_jsonb(row_value)::text collate "C"
  ) to stdout`, transport);
  const child = spawn(
    command,
    args,
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const hash = createHash("sha256");
  const stderr = [];
  child.stdout.on("data", (chunk) => hash.update(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Checksum query failed for ${schema}.${table}: ${Buffer.concat(
              stderr,
            )
              .toString("utf8")
              .trim()}`,
          ),
        );
        return;
      }
      resolve(hash.digest("hex"));
    });
  });
}

function migrationVersion(transport) {
  const relation = "supabase_migrations.schema_migrations";
  const exists = psql(
    `select pg_catalog.to_regclass('${relation}') is not null`, transport,
  );
  if (exists !== "t") return null;
  return (
    psql(
      `select version::text
       from ${relation}
       order by version::text desc
       limit 1`, transport,
    ) || null
  );
}

function listSequences(transport) {
  const output = psql(
    `select n.nspname || E'\\t' || c.relname
     from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'S'
       and n.nspname <> 'information_schema'
       and n.nspname !~ '^pg_'
       and not exists (
         select 1
         from pg_catalog.pg_depend d
         where d.classid = 'pg_catalog.pg_class'::regclass
           and d.objid = c.oid
           and d.deptype = 'e'
       )
     order by n.nspname collate "C", c.relname collate "C"`, transport,
  );
  if (!output) return [];
  return output.split("\n").map((line) => {
    const [schema, sequence] = line.split("\t");
    if (!schema || !sequence) {
      throw new Error("Database sequence inventory returned a malformed row.");
    }
    const relation = `${quoteIdentifier(schema)}.${quoteIdentifier(sequence)}`;
    const state = psql(
      `select last_value::text || E'\\t' || is_called::text from ${relation}`, transport,
    );
    return parseSequenceState(state, schema, sequence);
  });
}

export async function collectDatabaseEvidence(transport) {
  const tables = listTables(transport).map((entry) => ({
    ...entry,
    row_count: exactRowCount(entry, transport),
  }));
  const largest = tables
    .filter(({ row_count }) => row_count > 0)
    .sort(
      (left, right) =>
        right.row_count - left.row_count ||
        lexicalCompare(
          `${left.schema}.${left.table}`,
          `${right.schema}.${right.table}`,
        ),
    )
    .slice(0, 10);
  const checksummed = [];
  for (const entry of largest) {
    checksummed.push({
      ...entry,
      sha256: await deterministicChecksum(entry, transport),
    });
  }

  return {
    format_version: 1,
    migration_version: migrationVersion(transport),
    included_schemas: [
      ...new Set(tables.map(({ schema }) => schema)),
    ],
    tables,
    sequences: listSequences(transport),
    largest_non_empty_tables: checksummed,
  };
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export async function writeDatabaseEvidence({
  file = process.env.BACKUP_EVIDENCE_FILE,
  container,
} = {}) {
  if (!file) throw new Error("BACKUP_EVIDENCE_FILE is required.");
  writeFileSync(
    file,
    `${JSON.stringify(await collectDatabaseEvidence({ container }), null, 2)}\n`,
    "utf8",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await writeDatabaseEvidence();
}
