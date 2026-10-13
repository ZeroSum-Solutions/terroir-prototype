# Portable startup replan after attempts A and B

Status: **HOLD before attempt C pending independent source/evidence review.**

This is a bounded replan for M3/M5 portable-demo startup. It does not authorize a
production or hosted action, credential access, retained-data reset, cleanup of the
failed attempt-B resources, a `main` merge, or a deployment.

## Why the previous plan changed

Attempt A and attempt B failed at different concrete boundaries:

1. Attempt A stopped before database creation because `pnpm` attempted automatic
   dependency verification without a TTY, then because a runtime-root
   `node_modules` symlink left Turbopack with an external dependency path. Those two
   causes are closed for the next attempt by the stripped-environment
   `pnpm_config_verify_deps_before_run=false` setting and the contained filesystem
   copy. The copied, dotenv-free runtime subsequently completed a normal Turbopack
   build (73/73 static pages, exit 0):
   `/Users/zero/.claude/goal-state/terroir-restaurant-demo-20260927/proof/20261001-dotenv-free-copy-build.log`.
2. Attempt B started seven healthy, loopback-bound containers, but strict ownership
   admission correctly stopped before migration or user creation. The retained graph
   contained two networks and one unattached volume that the source contract did not
   admit. This invalidates the old assumption that the Docker network ID and the CLI
   `--network-id` value are interchangeable, and the old assumption that excluding
   Edge Runtime prevents its cache volume from being created.

No attempt-B Docker resource was changed, stopped, deleted, reseeded, or adopted
while producing this replan.

## Attempt-B evidence

Primary evidence:

- Resource graph:
  `/Users/zero/.claude/goal-state/terroir-restaurant-demo-20260927/proof/20261001-mobile-b-resource-diagnostic.jsonl`
- Launcher result:
  `/Users/zero/.claude/goal-state/terroir-restaurant-demo-20260927/proof/terroir-demo-20261001-mobile-b-evidence/launcher-result.json`
- Preserved observation:
  `/Users/zero/.claude/goal-state/terroir-restaurant-demo-20260927/proof/terroir-demo-20261001-mobile-b-evidence/preserved-docker-observation.json`
- Read-only base-ledger review:
  `/Users/zero/.claude/goal-state/terroir-restaurant-demo-20260927/proof/terroir-demo-20261001-mobile-b-evidence/db-review/base-ledger-read-only.md`

Observed facts:

- The owned pre-created network was
  `supabase_network_terroir-demo-20261001-mobile-b`, immutable ID
  `a31f6bf4d20b5ab6ef79a035616329f1bd4c7d541ccf0d839bf3c494a748ef5a`,
  execution label `75e2844e-1d3b-4bbf-8450-ff81109d7918`, bridge binding
  `127.0.0.1`.
- The launcher supplied that 64-hex ID to `--network-id`. Supabase CLI then created
  an extra empty network whose **name** was that 64-hex value and whose immutable ID
  was `a54a84cf24a3681feab5ccd842df15b08d5c951b6c6eff7ae853122202c8314e`.
  It had no execution label and no loopback binding option.
- All seven started containers attached only to the intended owned network ID
  `a31f6...`; database, API, and mail ports were bound to exact `127.0.0.1` ports.
- Even with `edge-runtime` excluded, CLI 2.109.1 created
  `supabase_edge_runtime_terroir-demo-20261001-mobile-b`. It was unattached, had the
  exact Supabase/Compose project labels, an empty execution label, and a creation
  timestamp after the owned network. The other two volumes were attached to admitted
  containers.
- Admission stopped at `owned-loopback-network-created`; no source migration or
  synthetic user step ran. The base-ledger absence guard remains required.

The installed `supabase` is version 2.109.1. Its read-only `supabase start --help`
describes `--network-id` as using the specified Docker network. Supabase's own local
development example passes a network **name** (`local-network`), and the CLI's public
issue record likewise documents `supabase start --network-id <name>`:

- [Supabase local development documentation](https://supabase.com/docs/guides/local-development?package-manager=pnpm&queryGroups=package-manager)
- [Supabase CLI issue #4644](https://github.com/supabase/cli/issues/4644)

The retained attempt-B graph is the decisive version-specific runtime evidence: with
2.109.1, the 64-hex immutable ID was also treated as a network name during startup.

## Materially different attempt-C contract

The next startup must use the already admitted network's **name** as the CLI input:

```text
--network-id network.name
```

The launcher continues to record `network.id` in its result and the ownership ledger.
Container attachment admission and cleanup therefore remain pinned to the immutable
Docker ID; only the CLI argument changes.

Stack admission continues to reject every extra network and every arbitrary
unattached volume. It admits one CLI-created excluded-service artifact only when all
of these are true:

1. its exact name is `supabase_edge_runtime_<project-id>`;
2. its Supabase and Compose labels equal the disposable project ID;
3. its execution label is the observed empty string;
4. its parseable creation timestamp is at or after the owned network's creation;
5. no container in the full Docker inventory uses it.

The admitted volume's name, creation timestamp, and labels enter the immutable
ownership ledger. Cleanup re-admission still refuses identity/label/timestamp drift,
new namespace resources, and any foreign container using an owned network or volume.
Cleanup still addresses containers and networks by immutable ID and the volume by its
re-admitted exact name plus `CreatedAt`, labels, and users. This is not a generic
orphan-volume allowance.

## Regression proof

Red test, before the source fix:

```text
node --test scripts/local/restaurant-demo/portable-demo.test.mjs
19 passed, 3 failed, exit 1
```

The failures were the required network-name source assertion and the two exact
excluded Edge Runtime volume admission/cleanup cases.

Green targeted test, after the source fix:

```text
node --test scripts/local/restaurant-demo/portable-demo.test.mjs
22 passed, 0 failed, 0 skipped, exit 0
```

Green complete restaurant-demo pure suite:

```text
node --test scripts/local/restaurant-demo/*.test.mjs
28 passed, 0 failed, 0 skipped, exit 0
```

The new negative cases refuse an unknown unattached volume, a pre-network creation
timestamp, a changed execution label, a foreign container using the volume, and a
post-ledger `CreatedAt` change.

## Source identity

Before this bounded fix:

- `launcher.mjs`: `c1e540fe3bcc2d78192b06e1689bddb9d80748a4e81b0eb83a2dbd3a811540c9`
- `docker-lifecycle.mjs`: `13ff6195b890d6d748ee83f5d3f94a9bc6d40e8407e8b03806c2551f80bafc53`
- `portable-demo.test.mjs`: `430b26f8d67cdffd0ea397366bc6eaea323e34a512927ff0b8f611804c538ba3`

After this bounded fix:

- `launcher.mjs`: `82ebbca87a373a216c33c77ebf7d514df1d9302a3693d120d696a33595678738`
- `docker-lifecycle.mjs`: `ab868f1c089c0d56f461e7898c289997649a53b9d8182848375cee9ed58a8e75`
- `portable-demo.test.mjs`: `4ef058125bc0599f8c68ae824704c3dc20fdf559760ceb9acd8d8c9ffcb3ec33`

## Review gate and next action

An independent reviewer must check the two runtime observations, the three-file diff,
and the red/green proof before attempt C. A passing pure suite does not authorize or
prove runtime startup.

If that review passes, use a fresh namespace and fresh destinations only:

- project: `terroir-demo-20261001-mobile-c`
- shadow/API/database/studio/mail ports: `62320/62321/62322/62323/62324`
- app: `3103`
- journey width: `390`

Attempt C must first prove fresh namespace and port absence, then proceed directly
through stack admission, base-ledger absence, transactional migrations, synthetic
fixture/auth, and the actual authenticated mobile application journey. Do not add
another harness layer or reuse attempt-B resources. Preserve any failure in place and
reassess the exact failing boundary.
