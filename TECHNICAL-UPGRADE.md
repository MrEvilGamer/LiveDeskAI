# Technical practice upgrade

Open **Practice** in the overlay or Settings. This opens a normal, visible window for preparation, mock interviews and assessments that explicitly permit AI assistance. Select a topic and question, choose short or extended depth, and either evaluate your answer or generate an example. Follow-up cases include prior context. Source links and common mistakes are shown alongside the reference. Edited custom questions can be discussed but are not graded using an unrelated rubric.

## Audit and implementation

The previous pipeline primarily optimized short spoken answers. Its personal-experience instructions could cause refusals on ordinary technical questions, and it had no sourced topic retrieval, independent scoring module or reproducible technical benchmark. Technical questions now use a tutor role and a classified answer structure, with relevant authored reference facts retrieved locally before generation. Saved project context is bounded and never used to invent experience.

The pipeline is: classify the task and follow-up context → retrieve relevant verified-source notes → generate an appropriately detailed explanation → check explicit known factual errors → present the answer or a labeled source correction. This does not expose hidden reasoning or execute arbitrary supplied code. Existing screen reading and conversation history remain available; the new practice workflow is explicit and visible.

- `src/coach/technical.js`: classification, indexed retrieval, depth-specific structure and reference corrections.
- `src/coach/knowledge.js`: 105 authored cards across seven domains, with source evidence and provenance.
- `src/coach/evaluator.js`: separate weighted rubric, critical-error veto, and local reviewer schema validation. Correctness 30, specificity 20, completeness 15, architecture 15, clarity 10, examples 10; inapplicable dimensions are renormalized.
- `src/renderer/llm.js`: technical tutor integration and bounded context construction.
- `src/overlay.js`: runtime factual-error guard; rejected raw claims do not enter answer history.
- `src/practice.html`, `src/practice.css`, `src/practice.js`, `src/coach/practice-cases.js`: practice UI, 210 curated questions, source links, optional separate local reviewer, safe text rendering and cancellation handling.
- `main.js`, `preload.js`, overlay and settings: practice window and navigation integration.

## Data, provenance and evaluation

`knowledge/seeds/*.tsv` contains the authored cards. `knowledge/sources.json` lists primary documentation. `knowledge/source-verification.json` records retrieval time, HTTP status and digest; cached text is in `knowledge/source-cache`. Finding the selected passage verifies provenance and availability, not every interpretation. Rebuild with `npm run coach:build-data`; reuse cached checks with `npm run coach:verify-sources`, or fetch fresh copies with `npm run coach:verify-sources -- --refresh`.

`benchmarks/technical.json` contains 210 unique questions, 30 per domain, including false-premise and follow-up cases. Each has a reference, criteria, common mistakes and sources. `benchmarks/adversarial.json` adds 14 ambiguity and missing-context challenges. Each pipeline is measured in short and extended modes. This is an internal open-book comparison: the retrieval notes overlap benchmark topics, so it is not a held-out accuracy test.

The baseline implementation and packaged archive are preserved under `benchmarks/baseline`. Raw outputs, timing and metadata are retained under `benchmarks/results`. Abandoned pilot runs are clearly named and excluded. The final deterministic guard is replayed consistently over retained upgraded raw outputs; original delivery records remain available. See [measured report](benchmarks/results/REPORT.md), [machine summary](benchmarks/results/summary.json) and [flagged errors](benchmarks/results/serious-errors.md).

The generator is the installed local `qwen3:4b-instruct-2507-q4_K_M`. A separate `qwen3:8b` provides selected independent model reviews, with no API key or paid calls. This is a fallible model opinion, not expert certification. The optional UI reviewer must differ from the generator. Invalid reviews cannot count as passes.

Automatic scores measure provisional criterion coverage. Critical factual errors fail regardless of the weighted total. Exact phrase checks can miss paraphrases and make mistakes; they cannot certify semantic correctness. The requested 95% accuracy target remains unproven and is not claimed. Further work requires exhaustive independent expert review and a held-out bank, plus integration checks against real PostgreSQL/RLS, GitHub Actions and distributed services.

## Validation and reproduction

- `node scripts/run-coach-regressions.js`: core, runtime guard, executable oracles, Electron practice UI, live pipeline and speech service suites. Results: `benchmarks/results/regressions.json`.
- `npm run test:technical`: corpus/retrieval/budget/reviewer checks and 22 executable Node, Rust, Bash, SQL and cryptographic oracles. SQL oracles use SQLite, not PostgreSQL. Results: `benchmarks/results/executable-oracles.json`.
- `npm run test:practice`: actual Electron UI regression and screenshot.
- `node scripts/complete-technical-benchmark.js`: resumable, sequential local benchmark, adversarial supplement, separate review and final report. Existing records are reused only with matching metadata. Running the complete benchmark takes time and GPU resources.
- `npm run dist`: rebuild the portable Windows application. `start-app.bat` selects the newest `dist/LiveDeskAI*.exe`.

Latency starts at local model HTTP dispatch, excluding screenshot/OCR and UI reading time. Warm-up is excluded; host activity and model residency can affect results. GPU memory is sampled from Ollama; runner RSS measures the benchmark process, not total application or model RAM. The report does not promise zero bugs or superiority over competing products.

## Review and final packaging notes

The final independent audit prioritizes every automatically flagged candidate and a focused, risk-selected seven-domain sample. It does not independently grade all 896 generated answers. Use `node scripts/review-technical-benchmark.js --full-review=true --skip-supplement=true` to expand the sample. Schema failures and timeouts remain in the audit log; valid retries are recorded separately. CPU review uses 12 threads and a 2048-token context because concurrent GPU-heavy applications caused resource contention. These reviewer runs are separate from the completed generator latency comparison.

The guard replay also removes a discovered false-positive correction where a candidate quoted an incorrect premise and explicitly rejected it. The regression suite covers that rejection. Packaged source hashes and the executable digest are recorded in `benchmarks/results/build-verification.json`.

The serious baseline findings are independently cross-checked against runnable Rust, Node and SQL fixtures in [verified error checks](benchmarks/results/verified-error-checks.md). The reviewer�s wording is qualified where necessary.

A final adversarial audit found a conflict between the technical tutor role and a legacy spoken-role user directive, plus missed Node scheduling classification. Both were corrected with regression tests; the upgraded main and adversarial inference runs were repeated. Earlier results and reviews are archived as `upgrade-v1-*` and excluded from final comparison.

After a completed benchmark, run `node scripts/verify-upgrade-deliverables.js` to verify answer counts, final source hashes, regression results, valid reviews for flagged candidates, and the packaged artifact. This checks consistency, not semantic accuracy.
