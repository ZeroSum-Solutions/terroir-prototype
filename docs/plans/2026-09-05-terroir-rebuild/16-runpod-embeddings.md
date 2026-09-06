# RunPod embedding host amendment

September 5, 2026. The user clarified that the intended embedding provider was **RunPod**, not Cerebras, and authorized use of existing RunPod credits. This amendment supersedes the embedding-host interpretation in [14](14-wine-similarity-and-cerebras.md). Earlier source checks and signed review records remain historical evidence; they are not rewritten to suggest that RunPod was previously evaluated.

## Decision and boundaries

RunPod supplies cloud GPU compute. **Qwen/Qwen3-Embedding-0.6B** is the first encoder candidate, retaining the existing shortlist. Supabase/Postgres remains the proposed vector and metadata store; RunPod is not the application's database or persistent memory store. [Qwen's model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) documents multilingual support and Matryoshka dimensions from 32 to 1024. Those generic capabilities do not establish wine retrieval quality.

The user authorized this provider and credit use. The initial execution scope is a small synthetic-only embedding trial, with a $1 operational budget target, one GPU and forced cleanup. This is not authorization to export existing production rows, house notes, purchase histories, ratings, invoices or personal profiles. No application route, database table or production credential changes are included. Private processing still needs the named account/region, data policy, authorization and retention controls in [13](13-ai-sommelier-concierge.md). A hosting change does not approve the reduced pilot scope or start the rebuild clock.

## Trial specification

- Provider: one temporary Secure Cloud RunPod **NVIDIA L4**, requested in the United States, 10 GB container disk, zero persistent volume. The exact allocation and price must be checked after creation.
- Encoder: `Qwen/Qwen3-Embedding-0.6B`, immutable revision `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`. Hugging Face metadata is ungated and lists Apache-2.0; runtime/model/data rights remain separate considerations.
- Runtime: official Hugging Face Text Embeddings Inference `cuda-1.9`, pinned manifest `sha256:249a0bc87522bfe2f1012b4d194f0225878f47079115ada3aeb0b1ef257b402a`. TEI [documents GPU serving of this model](https://huggingface.co/docs/text-embeddings-inference/quick_tour).
- Representation: encode 14 agent-authored synthetic sensory descriptions and six English/French/Spanish queries. The sensory text excludes producer, geography and price. Prefix queries with the frozen retrieval instruction; encode documents without that prefix. Return 1024 dimensions, take the first 512 and normalize again; record the transform as part of the embedding configuration.
- Checks: finite unit vectors, expected dimensions/count, rejected unauthorized embedding request, and a small labeled retrieval sanity check versus a lexical baseline. Labels and a 0.8 macro recall-at-3 smoke threshold are frozen before inference. The self-similarity calculation is only a mathematical sanity check; it does not establish retrieval quality. A deterministic Napa/Cabernet/price filter excluding unknown prices is a fixture-level design assertion, not a test of application or database enforcement. This tiny handcrafted set is not a production relevance benchmark.
- Spending: verify balance first, accept at most $0.80/hour for the one GPU, supervise an absolute 900-second trial deadline and terminate the exact trial-owned Pod. At that accepted rate, 900 seconds estimates $0.20 compute, plus storage and control/cleanup overhead. $1 is an operational target, not a provider-enforced account cap. Existing account resources and their costs are separate and remain untouched.
- Lifecycle: persist a unique ownership name and deadline, start a separate cleanup supervisor before the one create request, reconcile ambiguous responses without duplicate creates, and verify deletion. An unresolved create is reconciled through the full deadline because an early empty resource list is insufficient proof. RunPod control credentials stay only in the local controller; the GPU receives a separate ephemeral endpoint token. The HTTP proxy is publicly reachable during the trial; bearer authentication protects embedding requests. No tokens are written to evidence.

If cleanup returns `CLEANUP_REQUIRED`, stop further launches, immediately report the owned Pod ID/name and attempt termination through the RunPod API or authenticated console. Do not mark the trial complete until deletion is verified. The $1 target is not an account-level spending cap, and a local cleanup supervisor cannot guarantee termination during a control-plane outage or host failure.

## Verified execution result

**PASS for the bounded smoke test**, September 5 in Los Angeles (September 6 UTC). Both temporary Pods used one L4 in `US-MO-2` at a returned rate of $0.49/hour. The first attempt loaded the model but failed its 20-item request; the original response was not recorded. The second attempt reproduced that request as HTTP 429, `Model is overloaded`, then succeeded with ten sequential two-item batches. The [pinned TEI source](https://github.com/huggingface/text-embeddings-inference/blob/06670157fb6c1523482219bdb2d1660277d38088/router/src/http/server.rs#L669) acquires a permit for every sequence before awaiting the batch, explaining why 20 items exceeded the configured capacity of two. The fixture, model, labels and threshold stayed unchanged.

| Measured check | Result |
|---|---|
| Served model/runtime | Pinned Qwen revision; TEI 1.9.3, `float16` |
| Unauthorized embedding request | HTTP 401 on both attempts |
| Successful vectors | 20 finite, normalized 512-dimensional vectors after the recorded 1024-to-512 transform |
| Six-query macro recall@3 | 1.00; simple lexical word-overlap baseline 0.8333 |
| Successful attempt cold startup | 294.252 seconds from controller start to healthy model info |
| Twenty inputs after startup | 3.0677 seconds across ten sequential pairs, including HTTP/controller overhead |
| First attempt | Failed request; cleanup verified; estimated compute $0.046919 |
| Second attempt | Passed frozen checks; cleanup verified; estimated compute $0.041198 |
| Combined compute estimate | $0.088117, about $0.09; excludes storage and is not an invoice |
| Cleanup | Both Pods returned DELETE 204 and subsequent GET 404; fresh resource list contained neither |

Only synthetic descriptions and queries went to the GPU. The existing stopped Pod remained untouched; the account reported $0.022/hour spend before and after the trials. No Serverless endpoint or persistent volume was created. This test confirms embedding delivery and the small fixture's retrieval behavior; it does not establish recommendation quality, live filtering, production latency, sustained throughput or full operating cost.

[Machine-readable evidence](runpod-trial-evidence.json) preserves the frozen fixture, model/runtime pins, both outcomes, query rankings, timings, resource receipts and eight simulated controller/watchdog cases. The trial controller and test scripts remain in the task work directory. The pre-run Opus 5 review passed conditionally; its findings were checked against primary documentation and execution evidence. The separate reviewer approved the batching fix before the retry. The closing Opus 5 review also returned PASS for this bounded test. Review receipts and the verified dispositions below are included in the evidence file.

## Closing review and verified limitations

Opus 5 reviewed the live receipts through the existing subscription lane and returned **PASS for the bounded synthetic smoke test**. Independent review covered the controller change before the retry. The parent checked model/runtime source, rate fields and all eight fault-test receipts against saved artifacts. A separate verifier recomputed vector and retrieval checks from the saved outputs.

- Opus correctly identified a lexical tie artifact: the French and Spanish queries both have zero overlap with every document. The original stable sort returns the first three fixture rows anyway, giving the French query accidental credit. Keep the measured frozen baseline at 0.8333 and disclose the issue. A separately labeled, post-hoc diagnostic that requires positive overlap scores 0.6667. That value represents abstention on zero overlap, not a neutral tie-handling expectation. Neither value establishes comparative wine retrieval quality.
- Before production, align client batch limits with sequence capacity and test concurrency/backpressure. The successful trial deliberately retained a two-permit pool and sent pairs; a configured client maximum of 32 did not grant capacity for 32 sequences.
- Opus suggested `bfloat16` in the first review. The current TEI [CLI documents `float16` and `float32`](https://huggingface.co/docs/text-embeddings-inference/cli_arguments); this run retained supported `float16` and verified finite outputs. Changing numeric format or runtime requires a new embedding configuration and evaluation.
- The closing review packet omitted the created-Pod response and one earlier fault-test receipt. Those omissions limit what that reviewer independently inspected. The combined evidence includes both created-Pod rate records and all eight fault cases; both actual `adjustedCostPerHr` fields were null and base rates were $0.49/hour. The parent verified these records rather than treating the review verdict as a substitute for them.

## How this fits the rebuild

1. Stable source content hash, source/permission revision, model revision, dimensions, normalization and query/document instructions form the embedding identity. Cache by that identity and re-embed only changed or withdrawn material. Never mix incompatible vectors in one index.
2. Use typed SQL for stock, bin locations, producers, regions, vintages, prices and permissions. A nearest vector cannot determine where a bottle is stored or override a hard price constraint.
3. Keep separate candidate sources for sensory profile, producer relations, regional/vintage context, structured preferences and text meaning. Fuse/rerank only after eligibility filtering; record which evidence supported the result. A purchase and a positive tasting rating remain different signals.
4. Begin corpus indexing as bounded batches. Evaluate RunPod Serverless flex workers with minimum zero / maximum one for intermittent query embeddings once real latency and operating cost are measured. The measured Pod cold start is not a Serverless benchmark. A Serverless deployment still needs a queue handler or verified load-balancing port, health and authentication configuration. RunPod [supports configuring `HEALTH_CHECK_PATH`](https://docs.runpod.io/serverless/load-balancing/overview#health-checks), so a custom health adapter is not automatically required. This TEI Pod configuration has not been tested as a Serverless worker. Do not leave a dedicated Pod running for occasional queries. [RunPod bills startup, execution and the idle timeout](https://docs.runpod.io/serverless/pricing); cold starts are therefore both a latency and cost concern.
5. Retain lexical and exact-match fallback during model outage. Validate real rights-approved wine text, multilingual queries, withdrawal, permission changes, and recall/latency/cost at representative scale before choosing production settings or creating a shared vector index.
