# Machine, infrastructure, cost and model availability

## Measured capacity, September5

| Surface | Evidence | Assigned role |
|---|---|---|
| Mac Mini, Mac16,10 | 16GiB installed;10physical/logical CPUs;37GiB disk available;3,096MiB swap used; load3.60/3.34/2.66; macOS26.5.2 | Primary integrator and one active builder initially; subscription CLI orchestration; source/focused checks. No sustained browser fleet/full-suite work. |
| MacBook Pro | User-reported “45GB”; installed RAM/CPU/disk/load not measurable through any configured connection found; no SSH Host alias available | Unavailable for committed capacity until approved read-only connection. Do not interpret45GB as installed RAM. |
| Blacksmith | Required4-vCPU Ubuntu24.04 x64 jobs verified; median5m58.5s successful job | Existing required heavy gate; potential full-E2E home after parity canary |
| GitHub Actions | Full E2E and six surrounding workflows on ubuntu-latest; queue eligible but not configured | Baseline full-suite owner and orchestration. No runtime/AWS provisioning assumption. |
| AWS | CLI/config/profile absent in observed locations; historical guideline scripts absent; account/region/quota/SSO/instance inventory unverified | Optional synthetic benchmark/repro worker only after owner approval; excluded from Day 1 critical path |

Read-only MacBook inventory to run after authorized reach: `sysctl hw.memsize hw.physicalcpu hw.logicalcpu`, `vm_stat`, `sysctl vm.swapusage`, `df -h`, `uptime`, OS/runtime versions and current process/resource snapshot without command-line secrets. Compare with Mini using same commands and timestamp. Do not install SSH or activate remote control merely to measure it. Until then, one builder on Mini is the capacity baseline; cloud inference reviewers can run two bounded CLI sessions because inference occurs remotely, but watch local memory/latency.

No local heavy test begins unless one heavy lease exists, intended DB identity/ports verified, free disk≥20GiB and memory pressure normal. Stop admitting more work if swap grows>1GiB over a10-minute sample or responsiveness degrades. These are proposed operating thresholds, not today's benchmark. AWS/CI runs need no copied user environment. Session count/process count is not capacity.

## AWS proposal and selectable spend (B/C optional F; S starts with A)

Recommend one **c7i.2xlarge,8vCPU/16GiB,x86**, Ubuntu24.04,100GB encrypted gp3, only if hosted CI cannot provide a needed benchmark/reproduction. X86 matches present CI and avoids introducing ARM parity as another debugging variable. One heavy job at a time initially. Persistent disk caches immutable dependency/browser assets; per-SHA disposable workspaces/DBs hold synthetic fixtures. The instance type is documented by [AWS C7i](https://aws.amazon.com/ec2/instance-types/c7i/); final region availability/quote remains unverified.

| Option | Proposed usage | Planning estimate for 14days | Approval needed |
|---|---|---:|---|
| A, recommended start | Existing GitHub/Blacksmith only; no AWS | $0 incremental AWS; existing CI/hosting charges still apply | Verify remaining included allowance/current spend; no claim total cost is zero |
| B, bounded benchmark | Up to20 EC2 hours +100GB gp3 for 14days | $8 compute +$3.73 storage +$3 allowance = **$14.73** | Explicit chosen cap and quote; do not infer approval from this estimate |
| C, extended synthetic testing | Up to60 EC2 hours +same storage | $24+$3.73+$3 = **$30.73** | Explicit chosen cap and quote; no automatic upgrade from B |

Arithmetic assumes **$0.40/hour compute** as a conservative planning input, **$0.08/GB-month** ×100×14/30 storage, and a provisional$3 allowance for monitoring/network/IP/logs. It is not a current region-specific AWS quote or guaranteed all-in ceiling. Quote EC2, gp3, snapshot, CloudWatch, data egress and access-network costs before approval; use final quote to cap runtime. Public IPv4/NAT/endpoints can materially change small budgets. Avoid a new NAT gateway for this tiny worker; choose approved existing network or priced access path. AWS gp3 baseline includes3,000IOPS/125MBps; region pricing varies. [AWS EBS pricing](https://aws.amazon.com/ebs/pricing/?nc=nsb&pg=faq).

The prior budget is$800/month coding subscriptions and$100/month miscellaneous for the product. These options compete with Supabase/Railway/CI/content/maps/monitoring; no spare$100 is assumed. At Gate 1 reserve funds explicitly or choose A. Blacksmith advertises3,000 free minutes/month and a dynamic size-specific pricing page; current allowance and the4-vCPU account rate are unverified. Cost formula: required runner minutes×actual4-vCPU rate + full-suite minutes×selected runner rate + addons/GitHub charges, after verified credits. Do not apply the page's displayed$0.004/min to an unverified selected size. [Blacksmith pricing](https://www.blacksmith.sh/pricing).

## Access, shutdown and operational script contracts

Provisioning is not authorized now. Future plan: owner chooses account/region/network/spend; authorized operator uses short-lived SSO/role session. Separate provisioner, runner and stop-controller permissions. Restrict management to tagged Terroir test resources and explicit region; runner cannot read production stores or deploy. Prefer Session Manager with a minimal communication role and no inbound22, no copied developer keys, no root-account session. The management role needs only required Session Manager actions for this instance; any artifact store is separate and synthetic-only. [AWS Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html), [instance permissions](https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-instance-permissions.html).

Source arrives as a verified clean commit archive or short-lived repo-read credential scoped to the public repository; public source needs no GitHub secret. No `.env*`, Auth cookies, model subscription credentials, production invoice/images, customer rows, payment data or production Toast payloads may travel. Generated test credentials are local to disposable runner DB only. Fixtures must be synthetic; no production-derived anonymized export is permitted under S. Reviewer packets exclude secret/config values and production data. No production migration, backup restore, deployment or paid inference workload runs on this worker.

Required safeguards before first test: stop when no active job/lease for30 minutes; idle detector checks heartbeat/lease, not CPU alone; hard stop4 hours after each start and job timeout45 minutes, preserving partial evidence. Use an external tagged stop controller with permission limited to stopping this instance so a hung guest cannot defeat the maximum. A CloudWatch low-CPU stop alarm is only a secondary safeguard because network-bound jobs can be quiet. Verify alarm permissions and actual stop action on a synthetic smoke run. Stopped EBS still bills. [AWS alarm actions](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/UsingAlarmActions.html).

Proposed reusable script specifications, not runnable provisioners in this package:

| Future script | Contract and verification |
|---|---|
| `test-worker-plan` | Read account/region/quote, require approved spend/resource tags, produce resource diff and exact exclusions; refuses unknown account or missing cap |
| `test-worker-provision` | Only approved diff; encrypted storage, least privilege, no public DB, TTL/stop safeguards. Verify tags/identity/network/storage and a forced4-hour-stop test with compressed fixture clock |
| `test-worker-run` | Requires commit SHA/fixture hash/lease; rejects environment files, unsafe targets and missing stop timer; clean per-run local DB; capture command/exit/test inventory/resources/cost estimate |
| `test-worker-stop` | Collect redacted artifacts, stop approved instance only, verify stopped state, reconcile elapsed runtime; never auto-terminate |
| `test-worker-teardown-plan` | List residual disks/snapshots/roles/logs and charges; require explicit deletion approval after export/checksum verification. Do not treat runtime expiry as deletion consent |

Day 3 fallback: absent AWS → existing hosted full suite; absent MacBook → one Mini builder with remote reviews; absent new Blacksmith routing → keep ubuntu full E2E; absent queue → protected serialized landing. Candidate recovery destination unavailable or first candidate synthetic restore unattempted by Day 3 → synthetic demonstration only, real-pilot deadline NO-GO. If protected integration/candidate environment itself is unavailable, do not bypass: retain reviewed changes and downgrade to a synthetic/local proof, with deadline NO-GO for hosted S.

## Exact provider/harness availability

The current task-to-model policy and dated availability receipts are in [11-model-routing.md](11-model-routing.md). Fable 5.1 completed its real audit via Claude Max OAuth; Sonnet 5 completed an availability probe. Prior Opus 5, Sol and Gemini low probes/reviews remain dated evidence, not comparative throughput measurements. Gemini high is listed and its actual review receipt is recorded separately. Proxies on 11455/11456 were unavailable; do not bypass billing boundaries. No MacBook, AWS or extra model account capacity is assumed.

Latest provider constraint: Fable’s final reread hit the Claude session limit after its successful audit/conditional endorsement. Model routing in11 records the failed receipt and requires availability revalidation; earlier smoke probes are not current quota guarantees.
