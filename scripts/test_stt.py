import sys, types, threading, time, io, wave, json, urllib.request
import numpy as np

# ---- stub faster_whisper -------------------------------------------------
calls = []
class Seg:  # noqa
    def __init__(self, t): self.text = t
class FakeModel:
    def __init__(self, name, **kw): self.kw = kw
    def transcribe(self, x, **kw):
        calls.append(kw)
        time.sleep(0.35 if len(x) > 20000 else 0.01)       # pretend decode time
        rms = float(np.sqrt(np.mean(x*x)))
        txt = "thank you." if rms < 0.02 and len(x) > 40000 else "what is your biggest strength?"
        return iter([Seg(txt)]), types.SimpleNamespace()
sys.modules['faster_whisper'] = types.SimpleNamespace(WhisperModel=FakeModel)
import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import stt_server as S
from http.server import ThreadingHTTPServer

S.DEFAULT_MODEL = 'base'
S.get_model('base')
srv = ThreadingHTTPServer(('127.0.0.1', 0), S.Handler)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

def wav(seconds, amp):
    n = int(16000*seconds)
    x = (np.sin(np.arange(n)*0.05)*amp*32767).astype('<i2')
    b = io.BytesIO(); w = wave.open(b,'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(x.tobytes()); w.close()
    return b.getvalue()

def post(audio, interim=False):
    bd = '----x'
    body = b''
    def field(n,v): return ('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n' % (bd,n,v)).encode()
    body += field('model','base') + (field('interim','1') if interim else b'')
    body += ('--%s\r\nContent-Disposition: form-data; name="file"; filename="c.wav"\r\nContent-Type: audio/wav\r\n\r\n' % bd).encode() + audio + b'\r\n'
    body += ('--%s--\r\n' % bd).encode()
    req = urllib.request.Request('http://127.0.0.1:%d/v1/audio/transcriptions' % port, data=body,
        headers={'Content-Type':'multipart/form-data; boundary='+bd})
    return json.loads(urllib.request.urlopen(req, timeout=10).read())

ok = True
def check(name, cond, extra=''):
    global ok; ok &= bool(cond); print(('PASS ' if cond else 'FAIL ') + name, extra)

# 1. normal final
r = post(wav(2.0, 0.3)); check('final returns text', r['text'] == 'what is your biggest strength?', r)
# 2. decode kwargs: no fallback temps, no timestamps, no VAD
k = calls[-1]
check('temperature=0.0 (no fallback re-decode)', k['temperature'] == 0.0)
check('final decode uses five-beam search', k['beam_size'] == 5)
check('without_timestamps', k['without_timestamps'] is True)
check('vad_filter off', k['vad_filter'] is False)
check('condition_on_previous_text off', k['condition_on_previous_text'] is False)
# 3. silence gate: decoder not woken
n = len(calls); r = post(wav(2.0, 0.0005)); check('silence skips decoder', r['text'] == '' and len(calls) == n, r)
# 4. hallucination filtered
r = post(wav(3.0, 0.01)); check('"thank you." hallucination dropped', r['text'] == '', r)
# 5. priority: interim during a running final is skipped; final queues behind
res = {}
t_final = threading.Thread(target=lambda: res.__setitem__('f', post(wav(2.0, 0.3))))
t_final.start(); time.sleep(0.1)
r = post(wav(1.5, 0.3), interim=True)
check('interim skipped while a decode is running', r.get('skipped') is True, r)
t_final.join()
# 6. interim runs when idle
r = post(wav(1.5, 0.3), interim=True); check('interim runs when idle', r['text'] != '' and not r.get('skipped'), r)
# 7. finals wait (not dropped) and interim skipped while final waiting
out = []
ts = [threading.Thread(target=lambda: out.append(post(wav(2.0, 0.3)))) for _ in range(2)]
[t.start() for t in ts]; time.sleep(0.1)
r = post(wav(1.5, 0.3), interim=True); check('interim skipped while finals queued', r.get('skipped') is True)
[t.join() for t in ts]
check('both queued finals completed', len(out) == 2 and all(o['text'] for o in out))
# 8. bad audio
try:
    post(b'notawav')
    check('bad wav -> 400', False)
except urllib.error.HTTPError as e:
    check('bad wav -> 400', e.code == 400, e.code)
print('ALL PASS' if ok else 'SOME FAILED'); sys.exit(0 if ok else 1)
