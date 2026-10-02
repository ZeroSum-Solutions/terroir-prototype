# 0160 two-session concurrency proof proposal

This proof is deliberately separate from the rollback-only single-session
contract. A single session cannot prove lock waiting or last-lock-holder
behavior, and uncommitted rollback fixtures are not visible to a second
connection.

The root executor may run the proof only on the admitted disposable database
`terroir_section_0160_20260927a`, after the source review and the rollback-only
contract pass. It needs an independently reviewed, feature-specific harness
with two authenticated connections and bounded statement/lock timeouts. It
must not become a generic launch or admission framework.

The proof should use reserved 0160 UUIDs and perform these cases:

1. Commit a minimal owner/manager/site/wine/two-lot fixture, record a complete
   fixture fingerprint, and prove both actors lack `cost.read`.
2. Session A begins, assigns `First`, and holds the transaction after taking
   the wine lock. Session B begins and assigns `Second` to the same wine. A
   supervisor must observe B waiting on A's transaction lock before allowing A
   to commit. B then completes and commits. Verify every lot is `Second` and
   no non-section state changed.
3. For 0158 interoperability, hold the same wine lock in section assignment
   while `save_bottle_inventory_private` waits; after assignment commits, the
   later 0158 insert must retain its own default section. Reverse the order by
   letting 0158 commit its new lot before section assignment obtains the lock;
   that committed lot must be included by the assignment update.
4. Capture wait evidence from `pg_stat_activity`/`pg_locks`, exact receipts,
   and before/after cost and physical-state fingerprints. Do not describe
   scheduler order alone as concurrency proof.
5. Delete only the reserved fixture in dependency order, verify the saved
   pre-fixture fingerprint exactly, and run root's full final conservation.

There is no automatic retry. Any timeout, absent observed wait, unexpected
connection, cleanup mismatch, or conservation mismatch is a failed proof.
