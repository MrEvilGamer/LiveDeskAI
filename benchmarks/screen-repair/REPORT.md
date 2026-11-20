# Screen pipeline repair — measured report

The repaired portable is `dist/LiveDeskAI.exe` (also `LiveDeskAI-repaired.exe`). The prior portable and source snapshots are preserved in `benchmarks/screen-repair/baseline`. Restart the application to use the repair. The current machine has the free local OCR dependencies installed. This portable uses the existing local Python runtime; it is not a self-contained Python distribution. On another machine install `requirements-ocr.txt` in its configured runtime. Missing local OCR falls back to native Windows OCR and then configured vision, with lower reliability for code.

## Reproduced defects and targeted changes

Capture reported logical monitor dimensions despite downsampling to 1920 pixels. Capture now uses physical pixels with scaling, capped at 4096, reports returned dimensions, and rejects disconnected monitor selection explicitly. Complete OCR previously triggered vision anyway; switching vision/text models incurred repeated loading on this hardware. The repaired path classifies actual OCR first, bypasses vision only for sufficiently complete text, and keeps Ollama sessions warm. Native OCR damaged code operators and fragmented lines; a persistent local English RapidOCR worker and bundled verified recognition model improve code extraction. It caches unchanged regions and retains punctuation rather than inventing missing characters.

Declarative tasks were rejected by narrow question detection, and legacy NO_TASK could appear as a successful extraction. Classification now preserves full visible instructions and supporting code, distinguishes incomplete content, and only merges overlapping scrolling frames. Content beyond the captured viewport must actually be revealed by scrolling; the app does not invent or read invisible content. Vision fallback receives full-screen and lower-screen detail. A screenshot alone is never considered successful task extraction.

Old answers remained visible at capture start, queued animation frames could paint after cancellation, and periodic callbacks updated state before checking freshness. Capture, extraction and answer requests now have identifiers, obsolete work is canceled where supported, stale callbacks and queued paints are rejected, and new captures clear prior answer/source state. Typed unrelated questions no longer inherit an old screenshot.

## Diagnostics and privacy

Enable **Debug** in the capture preview to inspect the latest image, extracted text, request ID, stage timings and explicit error category. Image/text stay in memory and are hidden by default. Disabling Debug removes their DOM content. Categories include capture failure, wrong monitor, unreadable content, incomplete task, OCR/vision failure, unsupported content and model timeout. Timings cover monitor selection, capture/preprocessing, OCR/vision and classification, retrieval/preparation, model load/prefill/generation, deterministic verification and UI rendering. Queue plus transport is a residual estimate, not an independently observable provider queue. The local worker measures its own queue. Native OCR fallback uses transient files deleted in finally. Normal logs contain sanitized counts/status/timings, not screen content. The legacy diagnostic probe now requires explicit sensitive-debug opt-in.

## Measurements

`performance.json`: six requests per phase, counterbalanced, same three synthetic practice tasks twice, local qwen3:4b-instruct-2507-q4_K_M and qwen3-vl:2b-instruct. Real desktop capture runs in RAM and is discarded before substitution of the controlled fixture. Timing includes capture, fixture encoding, extraction, model request/generation, verification and actual Electron DOM rendering. The hidden test overlay omits the visible app's additional 150ms panel-hide delay. This small controlled hybrid benchmark is not a field latency guarantee. p50 is ordinary median; p95 is nearest rank (thus equals worst for six samples).

| Complete response | p50 | p95 | Worst |
| --- | ---: | ---: | ---: |
| Previous release | 10.481s | 12.526s | 12.526s |
| Repaired | 3.001s | 5.037s | 5.037s |

| Stage median | Previous | Repaired |
| --- | ---: | ---: |
| Capture | 672ms | 709ms |
| Extraction | 4258ms | 74ms |
| Answer-model load | 2677ms | 3.5ms |
| Model generation | 2446ms | 1914ms |
| Verification | 0.44ms | 0.27ms |
| UI rendering | 0.8ms | 0.4ms |

Individual stage medians do not sum to total median. Retrieval CPU profiling measured approximately 0.043ms median; deterministic verification was similarly negligible. They were not the seconds-scale bottleneck and remain enabled. Optional benchmark evaluation/scoring stays outside interactive responses. The material improvement came from avoiding unnecessary vision and model swapping, using persistent OCR and reusing regions. Capture and generation remain significant. The earlier 1.52s/2.59s results measured model-only work with differing output lengths and cannot be compared directly to this complete pipeline benchmark.

**The under-two-second complete response target is not met.** Hardware/model/output length and cold-start variation remain limitations. No extraction transport failures occurred in these twelve paired requests, but generated answers still contain factual errors. Narrow reference checks in `answer-checks.json` expose incorrect/incomplete median/code/Rust answers. All 420 technical prompt pairs remain byte-identical, but that does not establish semantic correctness equivalence. No verified-answer accuracy improvement or universal no-regression claim is made.

## Verification

- All six existing regression suites passed: core, 22 executable technical oracles, runtime factual veto, Practice UI, live pipeline and speech service (`regressions.json`).
- New pipeline/race tests reproduce old retained answers and generic failures, verify cancellation, stale queued paints, rapid requests, monitor/DPI selection, empty/incomplete/unsupported screens, OCR failures and model timeouts. The real stream bridge preserves timeout categories.
- Actual packaged pixel extraction: **19/20 = 95%** controlled readable fixtures across four DPI scales, top instructions/code below, multiple blocks, dark background and declarative questions. Additional 2560×1440, 3840×2160 and overlapping scroll fixtures pass; empty/partial/clipped negatives report errors. The 12px code at 100% scaling fails explicitly as INCOMPLETE_TASK because OCR drops punctuation. This limited test-set threshold is met, not a general 95% field-accuracy claim.
- Packaged debug UI tests verify private defaults, opt-in details, clearing on disable and accessible footer controls. Packaged source and OCR model bytes match workspace sources (`build-verification.json`, includes executable SHA256).

Run `npm test`, `node scripts/test-screen-error-bridge.js`, `node scripts/run-coach-regressions.js`, `npm run test:screen-ocr -- --packaged`, and `node_modules/.bin/electron scripts/test-screen-debug-ui.js --packaged`. Benchmark with `npm run benchmark:screen`. These generate synthetic test artifacts only.

The original failing live capture was not reproduced from the user's historical screenshot on its original running page. The source defects above are reproduced with controlled inputs; Debug now exposes which stage fails on a remaining real case. Real multiple-monitor/DPI selection is mocked in monitor tests; physical capture is measured on the available display. Hidden/offscreen code, unreadable fonts, non-English text and arbitrary visual layouts remain limitations. Enlarge or scroll content to expose it; never treat missing content as inferred task details.
