# Physical-open/revert race proof

This disabled source packet proves both lock orders at the exact retained-catalog
boundary. It uses the real `apply_import_batch_chunk`,
`execute_physical_bottle_command`, and `revert_import_batch_private` functions.
It does not apply migration 0164, create a database, or invoke Docker by itself.

Run only on the independently admitted retained 0164 target, as `postgres`,
with `psql -X -v ON_ERROR_STOP=1`. Every invocation supplies:

- `expected_database=<exact retained target name>`
- `target_admitted=on`
- `source_0164_sha256=b5416022789c096d9b94245770e543465d74a02f60c847270254e862545294ad`
- `race_mode=open_first` or `race_mode=revert_first`

For each mode, execute `physical-race-setup.sql` first. Start
`physical-race-a.sql` in connection A. After A has returned its RPC result and
entered the bounded eight-second hold, start `physical-race-b.sql` in connection
B. While B is blocked, run `physical-race-observe.sql`; it must return
`c09_0164_physical_wait_observed = 1` and identify A as B's sole blocker. Wait
for A and B to exit zero, then run `physical-race-verify.sql` and
`physical-race-cleanup.sql` with the same mode. Repeat from setup with the other
mode.

`open_first` commits a physical open, then requires the waiting revert to return
exact `P04D3 physical_bottle_dependency`. Verification preserves the applied
batch, row, inventory identity, wine LWIN pair, and the one exact bottle,
receipt, event, and effect.

`revert_first` commits the revert, then requires the waiting open to return exact
`P0001 no_inventory`. Verification preserves the reverted batch/row and retained
catalog wine with its LWIN pair cleared, with no physical receipt or effect from
the refused open.

Cleanup derives both the explicit and auto-onboarding restaurant/workspace
parents from the reserved actor. It refuses unless ownership is closed in both
directions and the selected mode's complete object graph is exact. Only after
that guard does it remove the purpose-built physical history and parents and
prove the reserved IDs are absent. Root-owned full target/protected-database
captures remain required before setup and after cleanup.

Expected terminal markers are:

- `C09_0164_PHYSICAL_RACE_SETUP_PASS`
- `C09_0164_PHYSICAL_RACE_A_PASS`
- `C09_0164_PHYSICAL_RACE_B_PASS`
- `C09_0164_PHYSICAL_RACE_VERIFY_PASS`
- `C09_0164_PHYSICAL_RACE_CLEANUP_PASS`

The observer has no terminal echo; its required scalar result is the proof.
No automatic retry is authorized by this packet.
