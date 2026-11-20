"""
LiveDesk AI — local STT server.

Exposes an OpenAI-compatible POST /v1/audio/transcriptions endpoint backed by
faster-whisper (the copy already installed in .venv), so the Electron app can
transcribe fully offline. No extra pip installs needed: stdlib HTTP + multipart.

Run:  .venv\\Scripts\\python.exe stt_server.py --model base --port 8399
"""

import argparse
import io
import json
import os
import re
import threading
import time
import wave
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

MODEL_LOCK = threading.Lock()
MODELS = OrderedDict()  # name -> WhisperModel
DEFAULT_MODEL = "base"
DEVICE_INFO = {}
USE_VAD = False  # the app already runs a VAD, so a second Silero pass is pure latency
COMMON_MODELS = ["tiny", "base", "small", "medium", "large-v3"]

# One inference at a time (parallel decodes just fight over the same cores).
# FINAL requests (utterance finished) always win: they queue and bump the counter,
# and INTERIM requests (live captions while somebody is still talking) are dropped
# the instant a final is waiting or another decode is running.
INFER_LOCK = threading.Lock()
COUNTER_LOCK = threading.Lock()
FINALS_WAITING = 0

# Things Whisper invents on near-silence / room noise.
HALLUCINATION = re.compile(
    r"^(thanks?( you)?( for (watching|listening))?|you|bye\.?|\.+|\u2026|subtitles? by .*|please subscribe.*|\[?(music|applause|silence|noise)\]?)[.!\s]*$",
    re.I,
)


def get_model(name):
    name = name or DEFAULT_MODEL
    with MODEL_LOCK:
        m = MODELS.get(name)
        if m is None:
            from faster_whisper import WhisperModel
            probe = np.zeros(16000, dtype=np.float32)
            model = None
            # Probe with a real inference: some boxes report CUDA fine but lack
            # cublas DLLs at compute time, so construction alone is not enough.
            for device, compute in (("cuda", "float16"), ("cpu", "int8")):
                try:
                    candidate = WhisperModel(
                        name, device=device, compute_type=compute,
                        cpu_threads=min(8, os.cpu_count() or 4), num_workers=1,
                    )
                    list(candidate.transcribe(probe, beam_size=1)[0])
                    # second warmup on noisy audio so the decoder path is hot
                    # before the first real sentence arrives
                    noise = (np.random.RandomState(0).randn(16000 * 2) * 0.05).astype(np.float32)
                    list(candidate.transcribe(noise, beam_size=1, without_timestamps=True)[0])
                    model = candidate
                    DEVICE_INFO[name] = device
                    print("[stt] loaded '%s' on %s" % (name, device))
                    break
                except Exception as e:
                    print("[stt] %s load failed (%s), trying next device" % (device, e))
            if model is None:
                raise RuntimeError("could not load whisper model '%s' on cuda or cpu" % name)
            MODELS[name] = m = model
            while len(MODELS) > 2:  # keep at most two models resident
                MODELS.popitem(last=False)
        MODELS.move_to_end(name)
        return m


def wav_bytes_to_float32(data):
    w = wave.open(io.BytesIO(data), "rb")
    n = w.getnframes()
    ch = w.getnchannels()
    sw = w.getsampwidth()
    sr = w.getframerate()
    raw = w.readframes(n)
    w.close()
    if sw == 2:
        x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sw == 4:
        x = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    elif sw == 1:
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError("unsupported WAV sample width: %d" % sw)
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if sr != 16000:
        count = max(1, int(len(x) * 16000 / sr))
        x = np.interp(np.linspace(0.0, len(x) - 1, count), np.arange(len(x)), x).astype(np.float32)
    return x


def parse_multipart(body, ctype):
    m = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', ctype or "")
    if not m:
        raise ValueError("no multipart boundary")
    boundary = (m.group(1) or m.group(2)).strip().encode()
    out = {}
    for part in body.split(b"--" + boundary):
        if part.startswith(b"\r\n"):
            part = part[2:]
        if part.endswith(b"\r\n"):
            part = part[:-2]
        if not part or part == b"--":
            continue
        head, sep, data = part.partition(b"\r\n\r\n")
        if not sep:
            continue
        headers = head.decode("utf-8", "replace")
        name = re.search(r'name="([^"]*)"', headers)
        if not name:
            continue
        if 'filename="' in headers:
            out["file"] = data
        else:
            out[name.group(1)] = data.decode("utf-8", "replace")
    return out


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    disable_nagle_algorithm = True  # TCP_NODELAY: don't hold small responses back

    def log_message(self, fmt, *args):  # per-request access logs are just console I/O
        pass

    def _send(self, code, obj):
        payload = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if self.path in ("/health", "/"):
            self._send(200, {"ok": True, "models": list(MODELS.keys()), "device": DEVICE_INFO})
        elif self.path == "/v1/models":
            names = sorted(set(COMMON_MODELS) | set(MODELS.keys()) | {DEFAULT_MODEL})
            self._send(200, {"object": "list", "data": [{"id": n, "object": "model"} for n in names]})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        global FINALS_WAITING
        if not self.path.endswith("/audio/transcriptions"):
            self._send(404, {"error": "not found"})
            return
        t0 = time.time()
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            parts = parse_multipart(body, self.headers.get("Content-Type", ""))
            audio = parts.get("file")
            if not audio:
                self._send(400, {"error": "missing file field"})
                return
            model_name = parts.get("model", DEFAULT_MODEL) or DEFAULT_MODEL
            lang = (parts.get("language") or "").strip() or None
            interim = (parts.get("interim") or "").strip() in ("1", "true", "yes")
            hotwords = (parts.get("hotwords") or "").strip()[:700] or None
            try:
                x = wav_bytes_to_float32(audio)
            except Exception as e:
                self._send(400, {"error": "bad wav: %s" % e})
                return

            # nothing but near-silence / a click: don't even wake the decoder
            rms = float(np.sqrt(np.mean(x * x)))
            if len(x) < 3200 or rms < 0.0015:
                self._send(200, {"text": "", "ms": 0})
                return

            model = get_model(model_name)

            if interim:
                if FINALS_WAITING > 0 or not INFER_LOCK.acquire(blocking=False):
                    self._send(200, {"text": "", "skipped": True, "ms": 0})
                    return
            else:
                with COUNTER_LOCK:
                    FINALS_WAITING += 1
                INFER_LOCK.acquire()
                with COUNTER_LOCK:
                    FINALS_WAITING -= 1
            try:
                segments, info = model.transcribe(
                    x,
                    language=lang,
                    beam_size=1 if interim else 5,
                    best_of=1,
                    temperature=0.0,                  # no fallback re-decodes (big latency spikes)
                    condition_on_previous_text=False,
                    without_timestamps=True,
                    vad_filter=USE_VAD,
                    no_speech_threshold=0.6,
                    log_prob_threshold=-1.0,
                    compression_ratio_threshold=2.4,
                    hotwords=hotwords,
                )
                text = " ".join(s.text.strip() for s in segments).strip()
            finally:
                INFER_LOCK.release()

            if HALLUCINATION.match(text) and rms < 0.02:
                text = ""
            ms = int((time.time() - t0) * 1000)
            print("[stt] %s %.1fs audio -> %d chars in %d ms" % ("interim" if interim else "final  ", len(x) / 16000.0, len(text), ms))
            self._send(200, {"text": text, "ms": ms, "speechVerified": bool(text)})
        except Exception as e:
            print("[stt] error:", e)
            self._send(500, {"error": str(e)})


def main():
    global DEFAULT_MODEL
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8399)
    ap.add_argument("--model", default=DEFAULT_MODEL, help="tiny/base/small/medium or faster-whisper model name (tiny.en / base.en are fastest for English)")
    ap.add_argument("--vad", action="store_true", help="run faster-whisper's own VAD pass (slower; the app already has a VAD)")
    args = ap.parse_args()

    global USE_VAD
    DEFAULT_MODEL = args.model
    USE_VAD = args.vad

    print("Warming up whisper model '%s' …" % args.model)
    get_model(args.model)
    print("Model ready (%s). Listening on http://%s:%d" % (DEVICE_INFO.get(args.model, "?"), args.host, args.port))

    ThreadingHTTPServer.daemon_threads = True
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
