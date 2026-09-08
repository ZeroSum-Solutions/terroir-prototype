# Terroir prototype: Rohan demo goal

Status: approved by Devin in this task on September 8, 2026.
Repository: `/Users/zero/projects/terroir-prototype`
Starting commit: `4437f87231dc7f89ee071fa1bd6fc597f1a38b7b`

## Approved completion checklist

1. Review the established demo flows, including login, cellar/photos, search, lists, Insights and scanning.
2. Fix demonstrated obstacles in the prototype.
3. Verify mobile behavior, tests, CI and independent review; explicitly report any hosted-access or provider blockers.

## Success criteria and evidence

- DEMO-01: Each listed flow has a recorded review result tied to the current build, including applicable navigation, loading, validation, errors and confirmation. Coverage gaps and skipped checks are named. Evidence: flow audit and browser/test artifacts.
- DEMO-02: Every demonstrated in-scope demo obstacle is fixed and rechecked, or has an explicit externally blocked status with evidence. Changes remain in the prototype and preserve unrelated work. Evidence: defect register, diffs and regression checks.
- DEMO-03: Final mobile checks, applicable automated tests and CI are recorded against the final commit. Independent review is recorded separately from mechanical proof. Hosted login/link, wine-photo coverage and real recognition readiness are reported accurately, including blockers. Evidence: final verification report and command logs.

## Execution

Audit current flows, repair demonstrated defects, then run final verification. The prior 92-pass browser run and CI are baseline evidence, not substitutes for checks affected by new changes. Keep existing design and authentication boundaries. No new features are added merely to broaden the demo.

The goal workflow requires an independent Grok advisory audit for each task plus deterministic proof. If the required reviewer is unavailable, record that limitation and leave the affected task incomplete.
