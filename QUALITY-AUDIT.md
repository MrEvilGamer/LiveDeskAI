# Reliability and answer-quality audit — 16 October 2026

Implemented fixes:
- Select the latest OCR question and retain wrapped text; join overlapping screen passages.
- Keep the arrow cursor over controls and text in both app windows.
- Strip hidden reasoning before segmenting code, including unfinished reasoning blocks.
- Handle final stream records without trailing newlines, explicit stop reasons, provider errors, and interrupted streams.
- Report token-limited answers as incomplete, preserving partial output.
- Reject empty model output as an error.
- Preserve spoken context for screen follow-ups.
- Tighten natural-language and factual-grounding instructions; avoid invented personal anecdotes for technical questions.

Validation:
- npm test: passed (speech detection, ordered transcription, text cleanup, streaming, screen freshness, cancellation, prompt budget, continuity, parser errors, recovery, audio quality).
- npm run test:live: passed against mock speech/model services inside Electron, including early answers and superseding corrected questions.
- python scripts/test_stt.py: passed using its stub transcription model.
- Electron scripts/test-answer-scroll.js: passed; preserves scroll position, reuses rendered nodes, resumes following at bottom.
- Electron scripts/test-ui-quality.js: passed computed cursor checks in overlay and settings. Electron emitted GPU teardown diagnostics after checks; visual device-specific behavior remains unverified.
- scripts/eval-local-answers.js: sampled three real responses from local qwen3:4b-instruct-2507-q4_K_M with synthetic user context. Initial technical answer invented a project detail. After prompt changes, the retest omitted that claim and declined to invent an employment story. These samples are qualitative checks, not a comprehensive accuracy benchmark.

Limits:
No claim of zero defects or superiority over competing products. Real microphone/headphone switching, suspend/resume, long sessions, every provider, and broad factual accuracy were not exhaustively tested. Model output still needs review. Screen continuity requires overlapping captured text; unseen content cannot be recovered.

Comparison context:
https://www.crackinterviewai.in/ advertises voice/text/screenshots, resume context, spoken outlines, audio device recovery, and session recovery. These public claims were not independently benchmarked. https://crackaiinterviews.co.in/ identifies itself as an ML/GenAI/LLM interview-preparation site; its detailed page content was unavailable to the web reader.

## Follow-up memory update

The app now retains up to 12 completed question/draft pairs in memory and includes up to six within each request budget. Recent screen and spoken context is included without the old screen-follow-up keyword restriction. Previous drafts are explicitly distinguished from facts about what the user said or did. Aborted, failed, superseded, and replaced drafts are excluded or replaced. Memory clears when the app exits.

Validation: scripts/test-conversation-memory.js passed for prompt history, budget, redo replacement, stale callbacks, cancelled/failed responses, and retention bounds. The full existing suite passed after the source changes. A real local-model follow-up sample referenced the earlier 60-second expiry correctly; this confirms context delivery, not general factual accuracy.

## Copied-question recovery

Confirmed the selected model is frob/qwen3.5-instruct:4b, a community non-thinking variant. Two direct local sample requests returned substantive answers with no thinking output (roughly 7 and 9 seconds end-to-end, including load/prompt work). The reported screenshot failure was not reproduced by those samples. Added one automatic retry with an explicit answer-only instruction when the copied-question guard fires. Recovery is bounded, keeps the selected model, and ignores retries superseded by a newer question. scripts/test-echo-recovery.js and the full existing test suite passed.

## Greeting false positive

User confirmed the failure happened when typing hello in Ask. The copied-question guard incorrectly treated a valid reciprocal greeting as an invalid answer, independently of the selected model. It now allows simple greetings and thanks while continuing to reject verbatim substantive questions. Regression checks cover hello, hi, good morning, thank you, copied questions, and real answers. All passed alongside the full suite. start-app.bat now applies a staged portable update on next launch when the old executable is unlocked.

## Manual screen and split-code capture

Removed overlay native title tooltips while retaining accessible labels. Manual capture now briefly hides app panels, serializes capture requests, restores panels after success or failure, and immediately reports capture/read progress. OCR no longer excludes the top 80 pixels and retains supporting code and task details from separate panes. Code tasks use vision to correct OCR operators, with labeled OCR fallback when vision is unavailable. Long prompts retain both the question at the beginning and code near the end. Local vision-capable answer models can receive the screenshot; models reporting vision but rejecting images (observed for installed frob/qwen3.5-instruct:4b due to missing mmproj) automatically fall back to extracted text.

Validation: full automated suite passed; manual capture visibility restoration, capability caching, text-only fallback, and long task preservation were checked. A real Windows OCR fixture with a top question and a lower code pane passed. The installed qwen3-vl:2b-instruct corrected OCR-lost operators from the fixture, and the selected frob answer model correctly returned 12 through the real native chat handler, including recovery from its missing image component. The user’s original full interview page was not available for reproduction.

## Lower-screen JavaScript review follow-up

The remaining top-only OCR shortcut is bypassed for complete manual reads and code-referencing periodic reads. Focused lower-screen images are paired with upper question/instruction OCR; supporting text survives even a short vision response. Overlapping full-plus-crop images initially produced duplicate-code interpretations in small models, so the focused code path uses a single lower crop with OCR context. The local Ollama task allowance is increased within the overall prompt budget, which now accounts for the complete system policy. The capture preview shows the consolidated extracted task first. Code-review prompts inspect concrete operations, with non-executing syntax hints for const declarations followed by compound updates; hints explicitly require checking variable scope.

Validation: full automated suite passed. The real Windows OCR/vision/native-answer test simulated OCR missing the lower code, retained the JavaScript, and ultimately identified the const reassignment and let fix using the configured community 4B model. Initial model review attempts failed despite receiving code; these were not transport losses and informed the prompt/syntax-hint changes. This is a focused regression test, not a guarantee of general code-review accuracy or a reproduction of the user’s original full Mercor screen.
