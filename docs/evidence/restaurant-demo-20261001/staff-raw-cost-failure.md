# Staff acquisition-cost confidentiality: FAIL

Target: fresh Mobile-C database through 0164, independently admitted as
described in `functional-contracts.md`. This is an actual database result,
not a mock, source inference or an unconfigured skipped test.

The exact `staff-raw-cost-probe.sql` bytes ran via:

```sh
docker --host unix:///Users/zero/.orbstack/run/docker.sock exec -i be1e35bbb6f67dda282207f8de293920146381dfaa1119ebb98c6625fd47b350 psql -X -v ON_ERROR_STOP=1 -qAt -U postgres -d postgres < staff-raw-cost-probe.sql
```

The probe created only a new synthetic identity and its new auto-created site
within one transaction. That identity's site role became staff, workspace
governance became null, and one new wine/inventory item used synthetic cost
47.75. The browser demonstration's wines, inventory and site were not touched.
The protected read ran as PostgreSQL `authenticated` with that staff subject.

Actual stdout:

```text
0c40a086-6bdd-4792-aef6-0e141e04a3b9
{"rawCostRows": 1, "rawCostValue": 47.75, "rawSelectACL": true, "costCapability": false, "governedCostRows": 0}
0
0
0
```

Stderr empty. Diagnostic exit code 0 means the observation succeeded; it does
not mean confidentiality passed. The staff member had no effective `cost.read`
and the governed cost reader returned zero rows, but a direct permitted
inventory-table SELECT recovered the acquisition cost.

The last three zeroes are post-ROLLBACK residual user, wine and inventory item
counts. No probe state was retained, and no ACL/schema/source change was made.

This falsifies M1's staff-cost confidentiality criterion. 0157 intentionally
leaves legacy table/column privileges untouched; no final ACL/Storage contract
migration exists through 0164. Hidden UI controls and denied governed readers
cannot close this path. A forward, independently reviewed seal and its actual
negative/positive runtime matrix remain necessary. This packet demonstrates
one raw-cost path, not an exhaustive inventory of every protected store.
