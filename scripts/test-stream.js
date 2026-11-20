const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const ctx = { performance, setTimeout, console, Promise, Float32Array, Uint8Array, ArrayBuffer, DataView, Math };
vm.createContext(ctx);
for (const f of ['src/renderer/audio.js', 'src/renderer/live.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
vm.runInContext('this.SpeechStream = SpeechStream; this.isHallucination = isHallucination;', ctx);
const { SpeechStream } = ctx;
const RATE = 48000, BLOCK = 2048;
const block = () => new Float32Array(BLOCK).fill(0.1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true; const check = (n, c, x = '') => { ok = ok && !!c; console.log((c ? 'PASS ' : 'FAIL ') + n, x); };

(async () => {
  // --- scenario 1: normal utterance, slow-ish STT. interims while talking, one ordered final
  const calls = [], events = [];
  let inflight = 0, maxInflight = 0;
  const mk = (delay, text) => new SpeechStream({
    kind: 'system', interimEveryMs: 120,
    transcribe: async (wav, o) => { calls.push({ interim: o.interim, bytes: wav.length }); if (o.interim) { inflight++; maxInflight = Math.max(maxInflight, inflight); } await sleep(delay); if (o.interim) inflight--; return { text: typeof text === 'function' ? text(o) : text }; },
    onInterim: (t) => events.push('I:' + t), onFinal: (t) => events.push('F:' + t), onDiscard: () => events.push('D'), onError: () => events.push('E')
  });
  let s = mk(40, (o) => o.interim ? 'what is your' : 'what is your biggest strength?');
  s.start(RATE);
  for (let i = 0; i < 40; i++) { s.push(block()); await sleep(20); }   // ~0.8 s wall, 1.7 s audio
  const interimsDuring = calls.filter(c => c.interim).length;
  check('interim requests fire while still speaking', interimsDuring >= 2, 'n=' + interimsDuring);
  check('never more than 1 interim in flight', maxInflight === 1, 'max=' + maxInflight);
  s.end(40 * BLOCK, 1.5);
  await sleep(150);
  check('final emitted after end', events.includes('F:what is your biggest strength?'), JSON.stringify(events));
  check('no interim after final', events.lastIndexOf('F:what is your biggest strength?') === events.length - 1);
  const fin = calls.find(c => !c.interim);
  check('final WAV = 16 kHz of full utterance (~44+2*16000*1.7)', fin && Math.abs(fin.bytes - (44 + 2 * Math.floor(40 * BLOCK / 3))) < 8, 'bytes=' + (fin && fin.bytes));

  // --- scenario 2: click / too short => discard, no STT call
  calls.length = 0; events.length = 0;
  s = mk(10, 'x'); s.start(RATE); s.push(block()); s.end(BLOCK, 0.01);
  await sleep(30);
  check('short click discarded without any STT call', events[0] === 'D' && calls.length === 0, JSON.stringify(events));

  // --- scenario 3: hallucination dropped
  events.length = 0;
  s = mk(10, 'Thank you.'); s.start(RATE); for (let i = 0; i < 30; i++) s.push(block()); s.end(30 * BLOCK, 1);
  await sleep(60);
  check('"Thank you." hallucination discarded', events.filter(e => e.startsWith('F:')).length === 0 && events.includes('D'), JSON.stringify(events));

  // --- scenario 4: finals stay in speech order even if the 1st request is slower
  events.length = 0;
  let n = 0;
  s = new SpeechStream({ kind: 'system', interim: false,
    transcribe: async () => { const my = ++n; await sleep(my === 1 ? 120 : 10); return { text: 'utt' + my }; },
    onFinal: (t) => events.push(t) });
  s.start(RATE); for (let i = 0; i < 30; i++) s.push(block()); s.end(30 * BLOCK, 1);
  s.start(RATE); for (let i = 0; i < 30; i++) s.push(block()); s.end(30 * BLOCK, 1);
  await sleep(250);
  check('finals emitted in order despite out-of-order completion', JSON.stringify(events) === '["utt1","utt2"]', JSON.stringify(events));

  // --- scenario 5: stale interim result after the utterance ended is ignored
  events.length = 0;
  s = new SpeechStream({ kind: 'system', interimEveryMs: 10,
    transcribe: async (w, o) => { await sleep(o.interim ? 80 : 5); return { text: o.interim ? 'STALE' : 'final text' }; },
    onInterim: (t) => events.push('I:' + t), onFinal: (t) => events.push('F:' + t) });
  s.start(RATE); for (let i = 0; i < 30; i++) s.push(block());
  s.end(30 * BLOCK, 1);                    // interim still in flight
  await sleep(200);
  check('late interim result is dropped, final wins', !events.includes('I:STALE') && events.includes('F:final text'), JSON.stringify(events));

  // --- scenario 6: transient failure retried once
  events.length = 0; let tries = 0;
  s = new SpeechStream({ kind: 'system', interim: false,
    transcribe: async () => { if (++tries === 1) throw new Error('socket'); return { text: 'ok after retry' }; },
    onFinal: (t) => events.push(t), onError: () => events.push('ERR') });
  s.start(RATE); for (let i = 0; i < 30; i++) s.push(block()); s.end(30 * BLOCK, 1);
  await sleep(300);
  check('final retried once on transient error', events[0] === 'ok after retry', JSON.stringify(events));
  console.log(ok ? 'ALL PASS' : 'SOME FAILED'); process.exit(ok ? 0 : 1);
})();
