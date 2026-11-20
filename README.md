# LiveDesk AI

The latest screen extraction and stale-response repair is packaged in `dist/LiveDeskAI.exe`. See [measured repair report](benchmarks/screen-repair/REPORT.md) for diagnostics, local OCR setup, tests and remaining limits. Complete response median measured 3.00s; the two-second target remains unmet.

A real-time, screen-share-stealthy AI copilot for live conversations on Windows — in the spirit of [Open-Cluely](https://github.com/shubhamshnd/Open-Cluely), running on **your own local models** (or any cloud API).

It listens to the voices coming out of your PC (meeting audio via system loopback, optionally your mic), transcribes them live, and drafts a short, natural-sounding answer the moment someone asks you something — in a floating overlay that **does not appear in screen shares or recordings**.

> Use only where recording and AI assistance are permitted. You are responsible for how you use this.

![overlay](smoke-overlay.png)

## Features

- **Invisible on screen share** — the overlay uses Windows `SetWindowDisplayAffinity` (via Electron content protection), so Zoom / Teams / Google Meet / OBS captures don't see it. It's also removed from Alt-Tab and the taskbar.
- **Truly live** — captions appear *while people are still talking*, and when someone is clearly asking you a question the answer starts streaming **before they finish the sentence**. See [Live mode](#live-mode-how-the-latency-was-removed).
- **Hears everyone** — captures Windows system-audio loopback (the other side of the call) and optionally your microphone, each with its own voice-activity detector, so utterances are cut on natural pauses.
- **Reads your screen** — toggle the 👁 button and a vision model screenshots the display every few seconds (the overlay never appears in those captures), feeding on-screen questions, problems and errors into the transcript and answers. Needs one vision-capable Ollama model, e.g. `ollama pull qwen2.5vl:7b` — the ⤓ button in Settings installs it for you.
- **Local transcription** — bundled `stt_server.py` exposes an OpenAI-compatible transcription endpoint backed by the faster-whisper already in `.venv`. Or point it at Groq / OpenAI Whisper in Settings.
- **Any LLM** — Ollama, LM Studio, OpenRouter, OpenAI, Groq… anything that speaks `/v1/chat/completions`. Streaming answers, auto-triggered when a question is detected (`Alt+Shift+A` to force one, or type your own in the **Ask** tab).
- **Doesn't sound like AI** — mode-specific prompts (meeting / interview / sales / custom) plus an output layer that strips markdown, AI-ish openers ("Sure!", "Great question"), bullet points and emojis, and enforces short spoken-style sentences you can read out loud.
- **Context is yours** — paste your role, résumé bullets or product info in Settings; answers are grounded in it.
- **Stealth ops** — collapse to a tiny pill (`Alt+Shift+C`), hide/show (`Alt+Space`), adjustable opacity. Runs with zero system footprint: no taskbar entry, no tray icon, not in Alt-Tab.

## Quick start

### OpenAI cloud option

Open Settings, enter an OpenAI API key in **OpenAI cloud setup**, and click **Use OpenAI for answers, screen and speech**. This configures GPT-4.1 for text and images, and GPT-4o mini Transcribe for speech. Use **Test connection** and **Test server** to verify your account access. API billing is separate from ChatGPT; captured speech and screenshots go to OpenAI while those features are enabled. The key is stored in the app's local settings.

The preset uses **Study / problem solving** mode and waits for final speech rather than repeatedly uploading partial audio. Screen reading remains under the eye toggle; enable its auto-answer checkbox if desired. **Answer now** considers the most recent screen task as well as spoken questions. Screen tasks retain choices, code and formulas, and the screenshot is also included in the answer request when the chat and vision model are the same.

Local transcription now starts automatically in the background when the app is configured for localhost port 8399 and this folder's Python environment is available. The manual transcription launcher remains available for troubleshooting.

Requirements: **Node.js** (for the app) and the included `.venv` (for transcription).

1. **Start local transcription** — double-click `start-stt.bat`
   (runs faster-whisper `base` on `127.0.0.1:8399`; first start warms the model up for a few seconds. Already verified working on this machine.)

2. **Start a local LLM** — install [Ollama](https://ollama.com) (it runs in the background automatically), then:
   ```
   ollama pull qwen3:4b-instruct-2507-q4_K_M
   ```
   (Or skip this and put an OpenRouter/Groq/OpenAI key + URL in Settings instead.)

3. **Start the app** — double-click `start-app.bat`. If a packaged build exists it launches `dist\LiveDeskAI.exe` silently (no console); otherwise it falls back to dev mode (`npm start`).

### Production build

```
npm run dist
```
produces **`dist\LiveDeskAI.exe`** — a portable x64 exe with the app icon and no console window. Launching it (or `start-app.bat`) runs fully silently: no taskbar entry, no tray icon, nothing in Alt-Tab. Quit from Settings → *Quit LiveDesk AI*, or press the hotkeys. `npm install` inside the folder is enough to keep developing (`npm start`).

Someone asks a question → the answer streams into the overlay within a couple of seconds. Read it out loud.

Each completed transcript entry has an **Answer** button. Click it to answer that specific entry, even with **Auto** off. The selected question appears above the answer; **Redo** repeats that selection. Newer transcript entries are excluded from that request's context. Screen reads that time out pause automatic retries for at least 15 seconds, and show an explicit timeout status.

Screen questions also work without a question mark, including introductions, who/when/where questions, yes/no questions, and greetings. A screen containing no identifiable question shows **No question found** with guidance. Missing or clipped supporting code remains an explicit incomplete-task error.

## How it works

```
 Windows loopback audio ─┐   streaming VAD (AudioWorklet): start → 43 ms blocks → end
                         ├──────────────────────────────────────────────┐
 Microphone (optional) ──┘                                              ▼
                                                              SpeechStream (per source)
                                       every ~450 ms ─► INTERIM  ─┐     │ on pause
                                                                  ▼     ▼
                                          live caption     /v1/audio/transcriptions  ── FINAL ─► transcript
                                                                  │
              THEIR question complete & stable? ◄─────────────────┘
                         │ yes: start NOW (early answer)           final text == early question?  keep : restart
                         ▼
                 /v1/chat/completions (stream) ─► humanize ─► answer card (painted once per frame)
```

- All network calls are made from the Electron main process, so there are no CORS issues with any provider.
- Auto-answer fires only for the "THEM" channel, only when the utterance looks like a question, with a short cooldown.

## Live mode: how the latency was removed

Before, nothing happened until the speaker stopped talking: 0.65 s of silence → whole clip uploaded → Whisper (plus a second VAD pass and possible re-decodes) → *then* the LLM started. Now every stage overlaps:

| Stage | Before | Now |
|---|---|---|
| End-of-speech detection | 0.65 s of silence | **0.42 s** (system) / 0.52 s (mic) |
| Captions | none until the clip finished | **live interim captions** every ~450 ms |
| Whisper settings | VAD pass + temperature fallback + timestamps | **single greedy pass, no VAD, no timestamps, no re-decodes** |
| STT scheduling | one global queue; a hung request blocked everything | finals have **priority** over interims, 25 s / 8 s timeouts, one retry |
| Starting the LLM | after the final transcript | **during the question** when it is complete and stable (same text twice, or ends in "?") |
| LLM warm-up | cold model after 5 idle minutes (Ollama) | 1-token keep-warm ping every 4 min for local models |
| Prompt | last 14 lines | last 10 lines, long lines trimmed, token cap by answer length |
| Rendering | full transcript rebuilt per update; repaint per token | incremental DOM, one repaint per frame |

An early answer is **kept** if the final transcript matches the question it was started for, and **replaced** (old stream aborted) if the speaker kept going and the question changed. The answer card shows what actually happened, e.g. `early · first word 0.31s · 1.4s total`.

Turn it off in **Settings → Behavior → Live mode** if you prefer answers only after the full sentence (it also saves tokens on paid APIs, since an early answer is sometimes discarded).

**Getting the last bit of speed (local):** the biggest remaining cost is Whisper on CPU. Use an English-only model (`start-stt.bat` → `--model base.en`, or `tiny.en`), a GPU build, or point Transcription at Groq (`whisper-large-v3-turbo`) in Settings.

## Settings

| Section | What to set |
|---|---|
| AI model | Base URL (`http://localhost:11434/v1` for Ollama), model — the ⟳ button lists the models the endpoint offers; you can also type any custom name. Optional API key. Test button included. **Set up local AI** starts the Ollama server and installs the configured model if missing. If the app finds its local Ollama endpoint down, it also repairs itself automatically (starts the server / pulls the model, progress shown in the strip). |
| Transcription | Local default `http://127.0.0.1:8399/v1` + model `base`. For Groq: `https://api.groq.com/openai/v1`, model `whisper-large-v3-turbo`, your key. |
| Behavior | Mode (meeting / interview / sales / custom), answer length, auto-answer on/off, mic sensitivity, and the **Context** box — the single biggest lever on answer quality. |
| Overlay | Stealth on/off (stealth off = the overlay becomes shareable, e.g. for demos), opacity. |

Config lives in `%APPDATA%/LiveDeskAI/config.json`. The old Python MVP's `settings.json` is migrated automatically on first run.

## Stealth notes

- Works on Windows 10 2004+ (this machine qualifies). Modern capture paths (DXGI/Graphics Capture — what Zoom, Teams, Meet-in-Chrome, OBS use) exclude the window entirely.
- Fullscreen exclusive captures of *other* monitors, some legacy GDI capture, and hardware capture cards may still see it. Verify with a quick self-recording before relying on it.
- Protecting against *you* being recorded ≠ authorization to use this where it's banned.

## Hotkeys

| Keys | Action |
|---|---|
| `Alt` + `Space` | show / hide overlay |
| `Alt` + `Shift` + `A` | answer now |
| `Alt` + `Shift` + `C` | collapse to pill |

## Troubleshooting

- **Status line says `lvl 0.000 · 0 chunks`** — nothing is reaching the default output device. Loopback captures the **Windows default output device only**: if your call plays through headphones/USB speakers that aren't the default, set them as default (Settings → Sound) or play test audio to confirm. The overlay shows an amber hint when this happens.
- **No "THEM" text appearing** — is `start-stt.bat` running? (a red strip in the overlay tells you when transcription is offline). Is anything actually playing? Wear headphones so your own voice doesn't double-transcribe.
- **"AI error: HTTP 404"** — Base URL must end in `/v1` (Ollama: `http://localhost:11434/v1`). Model name must match (`ollama list`).
- **STT slow** — if the server falls back to CPU (CUDA present but cuBLAS DLLs missing; it auto-detects this) use `tiny.en` / `base.en` locally, or switch STT to Groq in Settings for near-instant results. The server console prints `interim`/`final` lines with the decode time in ms.
- **Captions lag but answers are fine / the reverse** — the footer shows `stt 0.31s` (last final decode) and the answer card shows `first word …s`, so you can see which side is slow.
- **Answers sound robotic** — raise `maxTokens` slightly, add more context, or try a bigger chat model.

## Diagnostics

While listening, the footer status line shows `listening · lvl 0.031 · 5 chunks`:
- `lvl` — live loudness arriving from the capture (0.000 = total silence from that device),
- `chunks` — how many voice segments the VAD has cut so far,
- a **red strip** appears if transcription requests fail (STT server down / wrong URL),
- an **amber strip** appears if 12 s pass with zero sound from the default output device.

## Project layout

```
main.js                  Electron main: overlay/settings windows, config,
                         hotkeys, all network I/O (LLM stream + STT proxy)
preload.js               the small contextBridge API surface (window.liveDesk)
src/overlay.html/css/js  the always-on-top copilot UI
src/settings.html/css/js the settings window
src/renderer/audio.js    loopback/mic capture + streaming VAD worklet + WAV encoding
src/renderer/live.js     SpeechStream: interim + final transcription per source
src/scrollbar.css        shared ::-webkit-scrollbar styling (overlay + settings)
src/renderer/llm.js      prompt design (modes, human-speech rules) + stream client
src/renderer/humanize.js strips markdown / AI-isms from model output
scripts/gen-icon.js      generates assets/icon.png (runs on npm install)
scripts/test-audio.js    live capture+STT harness  (npx electron scripts/test-audio.js)
scripts/test-sse.js      SSE parser test          (node scripts/test-sse.js)
scripts/test-live.js     end-to-end: real app + mock STT/LLM, checks early answers (npm run test:live)
scripts/test-vad.js, test-stream.js, test-humanize.js, test_stt.py   unit tests (npm test, npm run test:stt)
stt_server.py            local OpenAI-compatible transcription server (faster-whisper)
start-app.bat / start-stt.bat  one-click launchers
livedesk.py, run.bat, install.bat  the old visible-window MVP (unused, kept for reference)
```

## Tests

```
npm test            # VAD worklet, streaming transcriber, humanizer, SSE parser (no display needed)
npm run test:stt    # STT server scheduling/gating logic against a stub model
npm run test:live   # launches the real app against mock STT + LLM servers; verifies early answering,
                    # answer replacement, statements ignored, live captions (needs a display;
                    # on headless Linux: xvfb-run -a with ELECTRON_EXTRA_ARGS="--no-sandbox --disable-gpu")
```

## Legacy Python MVP

The original visible-window prototype (`livedesk.py`, Tkinter + soundcard, no stealth) is still here and untouched — run it with `run.bat` if you ever want it. The Electron app supersedes it and migrated its settings.

### Screen reading while scrolling

Enable the eye toggle to read newly visible content at the configured screen interval. The reader selects the latest visible question, includes wrapped lines, and joins successive passages when at least four overlapping words establish continuity. Scroll with a few lines still visible so the reader can connect the passages. Content that never appears in a capture cannot be recovered. Repeated manual captures avoid duplicate transcript entries for 30 seconds.

### Follow-up context

Completed answers are retained as question/draft pairs for the current app session (up to 12). Each request includes up to six recent pairs within the prompt budget, alongside the latest spoken and screen context. Follow-ups can refer to previous suggestions or code; new questions and corrections take precedence. Cancelled, failed, and superseded responses are excluded. Redo replaces the saved draft for that question. Suggestions are not treated as proof that the user actually said or did something. Restarting the app clears this answer memory.

## Technical practice upgrade

Open **Practice** from the overlay or Settings for a visible preparation window with 210 sourced technical questions, short/extended explanations, follow-up context, reference answers and a separate provisional evaluator. Local models require no API key. A different installed local model can provide an optional second review.

See [implementation and validation](TECHNICAL-UPGRADE.md) and [measured benchmark results](benchmarks/results/REPORT.md). Automatic rubric scores are not certified accuracy; the 95% target remains unproven. Use the software for preparation, mock interviews and assessments where assistance is explicitly permitted.
