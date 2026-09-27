import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rehearsal = readFileSync(
  resolve(
    process.cwd(),
    "scripts/local/physical-bottle-phase-a-rehearsal.sh",
  ),
  "utf8",
);

function extractFixtureCaptures(): string {
  const pre0153Start = rehearsal.indexOf(
    'pre0153_restaurant=$(psql_cmd "$base_db"',
  );
  const pre0153End = rehearsal.indexOf('psql_cmd "$base_db" -c', pre0153Start);
  const fixtureStart = rehearsal.indexOf(
    'fixture_restaurant=$(psql_cmd "$base_db"',
  );
  const fixtureEnd = rehearsal.indexOf('psql_cmd "$base_db" -c', fixtureStart);

  if ([pre0153Start, pre0153End, fixtureStart, fixtureEnd].some((i) => i < 0)) {
    throw new Error("Missing C06 UUID fixture capture block");
  }

  return [
    rehearsal.slice(pre0153Start, pre0153End),
    rehearsal.slice(fixtureStart, fixtureEnd),
  ].join("\n");
}

describe("C06 Phase A UUID fixture capture", () => {
  it("suppresses realistic INSERT command tags for every UUID assignment", () => {
    const captureBlock = extractFixtureCaptures();
    const result = spawnSync(
      "/bin/bash",
      [
        "--noprofile",
        "--norc",
        "-c",
        [
          "set -euo pipefail",
          "base_db=fake-database",
          "run_id=unit",
          "psql_cmd() {",
          "  local database=$1",
          "  shift",
          "  local quiet=0",
          "  local argument",
          "  local sql=",
          '  for argument in "$@"; do',
          "    sql=$argument",
          '    case "$argument" in -*q*) quiet=1 ;; esac',
          "  done",
          '  printf \'%s\\n\' "$C06_UUID"',
          '  if [[ "$sql" == insert* ]] && [ "$quiet" -eq 0 ]; then',
          "    printf '%s\\n' 'INSERT 0 1'",
          "  fi",
          "}",
          captureBlock,
          "for value in \"$pre0153_restaurant\" \"$pre0153_user\" \"$pre0153_wine\" \"$fixture_restaurant\" \"$fixture_wine\" \"$fixture_bottle\" \"$fixture_user\"; do",
          '  test "$value" = "$C06_UUID"',
          "done",
          "printf '%s\\n' UUID_FIXTURE_CAPTURE_PASS",
        ].join("\n"),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: "/usr/bin:/bin",
          C06_UUID: "11111111-2222-4333-8444-555555555555",
        },
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("UUID_FIXTURE_CAPTURE_PASS\n");
    expect(
      captureBlock.match(/\$\(psql_cmd "\$base_db" -qAtc/gu),
    ).toHaveLength(7);
  });
});
