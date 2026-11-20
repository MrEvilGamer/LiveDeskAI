# Technical practice benchmark results

Generated 2026-10-16T18:55:49.735Z.

This is an internal, open-book comparison using the same local model, temperature, seed, task set and output budgets for both pipelines. The upgrade retrieves authored, source-backed topic notes; the baseline does not. These notes overlap the benchmark topics. This is not a held-out general-intelligence benchmark. The bank was also used during development to identify failures and add regression guards, including outbox atomicity and timer ordering. It is a development-bank result; a blinded held-out expert review is still needed. The same final scoring implementation is applied again to both saved answer sets; short answers use essential criteria while extended answers use the full criteria, so short answers are not penalized merely for brevity.

**The 95% semantic-accuracy acceptance target is not certified.** The automatic metric below is provisional criterion coverage, not verified technical accuracy.

| Main benchmark | Baseline | Upgraded |
|---|---:|---:|
| Answers | 420 | 420 |
| Provisional rubric pass rate | 20.5% | 64.8% |
| Mean heuristic score | 48.5 | 80.2 |
| Detected serious errors after delivery guard | 2 | 0 |
| Labeled reference corrections | 0 | 1 |
| Transport errors | 0 | 0 |
| Detected spoken-role narration | 23 | 0 |
| Token-limited answers | 0 | 6 |
| Median output tokens | 45 | 81 |
| Median first token | 0.12s | 0.22s |
| 95th-percentile first token | 0.15s | 0.28s |
| Median total response | 1.52s | 2.59s |
| 95th-percentile total response | 3.15s | 5.22s |

The main bank contains 210 questions across seven domains, each tested in short and extended modes: 420 answers per pipeline. There are also 14 supplemental adversarial questions, tested in both styles. TTFT and total time begin at local HTTP dispatch; they do not include screenshot/OCR capture or UI reading time. Warm-up is excluded. The final deterministic verifier is replayed over saved raw candidates for upgraded delivery corrections; original generation and delivered text are retained. The small abandoned concurrent pilot is archived and its marked baseline latency overlap is excluded. Host activity and model cache effects remain limitations.

| Domain | Baseline provisional pass | Upgraded provisional pass |
|---|---:|---:|
| algorithms | 23.3% | 70.0% |
| distributed | 38.3% | 71.7% |
| git | 10.0% | 73.3% |
| node | 13.3% | 60.0% |
| rust | 16.7% | 58.3% |
| security | 25.0% | 68.3% |
| testing | 16.7% | 51.7% |

## Depth and resource measurements

| Answer depth | Baseline provisional pass | Upgraded provisional pass |
|---|---:|---:|
| short | 25.2% | 66.2% |
| extended | 15.7% | 63.3% |

| Resource | Baseline | Upgraded |
|---|---:|---:|
| Maximum sampled model VRAM (GiB) | 3.08 | 3.08 |
| Maximum benchmark runner RSS (GiB) | 0.07 | 0.07 |

These are sampled model residency and benchmark-process memory, not total system memory or packaged UI memory. Generator: qwen3:4b-instruct-2507-q4_K_M; temperature 0.2, seed 42, context 8192 tokens; output budgets 180 short / 420 extended. See per-run metadata and hardware.json.

## Adversarial supplement

Baseline provisional pass: 53.6%; upgraded: 57.1%. The cases include false premises, missing project history, ambiguous scheduling, impossible constraints, and absent follow-up context.

## Separate review

23 valid reviews by qwen3:8b, with 1 unavailable or schema-invalid results. Automatically flagged candidates: 7; lacking a valid separate review: 0. The reviewer marked 9 answers as containing serious factual errors. This is a separate, fallible local-model opinion, not independent expert certification. When the delivery guard corrected an answer, its original raw error is reviewed and labeled separately. The sample is risk-selected and must not be extrapolated into an overall accuracy estimate. See independent-review.jsonl and serious-errors.md.

## Remaining acceptance gaps

- No exhaustive independent expert semantic review has been completed.
- Automated coverage metrics must not be interpreted as a certified 95% technical accuracy result.
- The tested local 4B pipeline also remains below 95% on provisional criterion coverage.

Further limits: exact phrase checks miss paraphrased contradictions; a reviewer can be wrong; current source evidence lookup verifies provenance and passage availability rather than proving every authored reference; SQL executable oracles use SQLite and do not verify PostgreSQL RLS; no live GitHub Actions runner or distributed Kafka/PostgreSQL service was provisioned.

## Regression, executable and build verification

6/6 regression suites passed. 22/22 executable technical checks passed. The packaged Practice page passed the actual Electron UI test. Packaged source contents matched the workspace; artifact digest and file hashes are in build-verification.json. See regressions.json, executable-oracles.json, practice-ui.png and [independent error checks](verified-error-checks.md).

The focused separate-model audit includes a risk-selected seven-domain sample and every automatically flagged error, with extra valid early reviews retained. Schema-pilot failures are archived in reviewer-schema-pilot.jsonl. The main review log preserves a GPU-contention timeout, which is not counted as a valid review. The final focused audit runs on CPU. Review devices and output/context budgets are recorded per attempt and are distinct from generator latency measurements. Earlier upgraded prompt iterations and reviews are archived as upgrade-v1-* and excluded from final comparison.
