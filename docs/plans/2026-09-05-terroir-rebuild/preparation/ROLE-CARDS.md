# Inactive role cards

Every role loads the same protocol and receives a TASK-CARD with exact file paths, model/harness/session, evidence, estimate and stop criteria. These cards do not create agents or grant concurrent writes.

| Role | Bounded responsibility | Initial routing |
|---|---|---|
| C | Candidate access/read and integration coordination; never self-land | Sol high |
| D | Sole schema/transaction authority; migration/down/type generation and real SQL invariants | Opus5 high |
| R | Complete manual receipt vertical slice, lookup backend and UI | Sol high |
| O | Candidate operational controls/recovery; alternate controller | Opus5 high |
| Q | Fixtures, focused/full gate ownership, independent evidence and protocol activation | Sol xhigh for tests/review; high for straightforward implementation |
| Routine helper | Packet-only extraction/docs/fixture draft; no independent repo claim | Sonnet5 medium |
| Architecture consultant | Bounded contested design or critical-path re-plan | Fable5.1 high |

Separate vendor reviewers and non-author stewards/landers are assigned per07. A helper that contributes code is an author for independence, even if someone else pastes it. Routine helpers may not silently mutate outside a single active builder's claim.
