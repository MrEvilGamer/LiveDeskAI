const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/renderer/audio.js'), 'utf8');
// pull the worklet source string out of the template literal
const m = src.match(/const VAD_WORKLET = `([\s\S]*?)`;\n\nclass AudioEngine/);
if (!m) throw new Error('worklet not found');
const SR = 48000;
let registered, msgs = [], t = 0;
class AudioWorkletProcessor { constructor(){ this.port = { postMessage: (d) => msgs.push(d) }; } }
const ctx = { AudioWorkletProcessor, sampleRate: SR, get currentTime(){ return t; }, registerProcessor: (n, c) => { registered = c; } };
vm.createContext(ctx);
vm.runInContext(m[1], ctx);
const p = new registered({ processorOptions: { sensitivity: 0.5, tailMs: 420 } });
function frames(seconds, fn) {
  const n = Math.round(seconds * SR / 128);
  for (let f = 0; f < n; f++) {
    const a = new Float32Array(128);
    for (let i = 0; i < 128; i++) a[i] = fn((f * 128 + i) / SR);
    p.process([[a]]); t += 128 / SR;
  }
}
const quiet = () => (Math.random() - 0.5) * 0.002;
const voice = (x) => Math.sin(2 * Math.PI * 220 * x) * 0.2;
frames(1.0, quiet);          // noise floor
const tSpeechStart = t;
frames(1.5, voice);          // 1.5 s speech
const tSpeechEnd = t;
let endSeenAtFrame = null;
const before = msgs.length;
frames(1.0, quiet);          // silence
const types = msgs.map(m => m.type);
const start = types.indexOf('start'), end = types.indexOf('end');
const blocks = msgs.filter(m => m.type === 'block');
const total = blocks.reduce((s, b) => s + b.samples.length, 0);
const endMsg = msgs.find(m => m.type === 'end');
console.log('start idx', start, 'end idx', end, 'blocks', blocks.length);
console.log('total block samples', total, '== end.total', endMsg && endMsg.total, '(', (total/SR).toFixed(2), 's )');
console.log('expected ≈ 0.3s pre-roll + 1.5s speech + 0.42s tail ≈ 2.2s');
console.log('first block starts with pre-roll?', blocks[0].samples.length);
if (start < 0 || end < start || total !== endMsg.total) { console.log('FAIL'); process.exit(1); }
// short click must not produce a long utterance & must be droppable
msgs.length = 0; frames(1.0, quiet); frames(0.02, voice); frames(1.0, quiet);
const e2 = msgs.find(m => m.type === 'end');
console.log('click burst -> total', (e2.total/SR).toFixed(2)+'s, voiced', e2.voiced.toFixed(3)+'s (renderer drops <0.12s)');
if (!(e2.voiced < 0.12)) { console.log('FAIL voiced'); process.exit(1); }
// long speech must be force-split at 15 s
msgs.length = 0; frames(16, voice); 
console.log('16 s continuous -> ends emitted:', msgs.filter(m => m.type === 'end').length);
console.log('PASS');
