// End-to-end test of the live pipeline INSIDE the real app.
//
// Launches the actual Electron app against a mock STT server and a mock streaming LLM,
// feeds speech blocks into the same SpeechStream the audio engine uses, and checks:
//   A. a question is answered EARLY — the LLM request starts before the final transcript returns
//   B. if the final transcript differs from what the early answer was for, the early answer is replaced
//   C. non-questions never trigger an answer
//   D. live captions appear while speaking and are replaced by the final line
//
// Run:  node scripts/test-live.js          (needs `npm install` first; no mic/loopback required)
//   Linux/CI without a display:  xvfb-run -a node scripts/test-live.js   (+ ELECTRON_EXTRA_ARGS="--no-sandbox --disable-gpu")

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ---------------------------------------------------------------- mock servers

const log = { llm: [], sttFinalDone: [], llmClosed: 0 };
let scenario = { interim: [], final: '' };
let interimCount = 0;
let llmTokenMs = 45;      // scenario B slows this down so the early answer is still streaming when it is superseded

const sttSrv = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const isInterim = body.includes('name="interim"');
    const seconds = Math.max(0, (body.length - 400) / 32000);
    res.setHeader('Content-Type', 'application/json');
    if (seconds < 0.7 && !isInterim) { res.end(JSON.stringify({ text: '' })); return; }   // the app's own silence probe
    if (isInterim) {
      const i = Math.min(interimCount++, scenario.interim.length - 1);
      res.end(JSON.stringify({ text: scenario.interim[i] || '' }));
    } else {
      setTimeout(() => {
        log.sttFinalDone.push(now());
        res.end(JSON.stringify({ text: scenario.final }));
      }, 180);   // a realistic final-decode time
    }
  });
});

const llmSrv = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let j = {};
    try { j = JSON.parse(Buffer.concat(chunks).toString()); } catch (_) {}
    if (!j.stream) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'pong' } }] })); return; }
    const userMsg = (j.messages || []).map((m) => m.content).join('\n');
    const q = (userMsg.match(/Answer exactly this question I was just asked: "([^"]*)"/) || [])[1] || '';
    const entry = { at: now(), question: q, closedEarly: false };
    log.llm.push(entry);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const words = ('I would say staying calm under pressure is my biggest strength and I back it up with clear communication').split(' ');
    let i = 0;
    const t = setInterval(() => {
      if (i >= words.length) { clearInterval(t); res.write('data: [DONE]\n\n'); res.end(); return; }
      if (i === 0) entry.firstTokenAt = now();
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: (i ? ' ' : '') + words[i] } }] }) + '\n\n');
      i++;
    }, llmTokenMs);
    res.on('close', () => { clearInterval(t); if (i < words.length) { entry.closedEarly = true; log.llmClosed++; } });
  });
});

// ---------------------------------------------------------------- CDP driver (Node 22 global WebSocket)

async function cdp(port) {
  let targets = [];
  for (let i = 0; i < 60; i++) {
    try {
      targets = await (await fetch('http://127.0.0.1:' + port + '/json', { signal: AbortSignal.timeout(750) })).json();
      if (targets.some((t) => /overlay\.html/.test(t.url))) break;
    } catch (_) {}
    await sleep(250);
  }
  const page = targets.find((t) => /overlay\.html/.test(t.url));
  if (!page) throw new Error('overlay page not found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, e) => { const timer=setTimeout(()=>e(new Error('CDP connection timeout')),5000); ws.onopen=()=>{clearTimeout(timer);r();}; ws.onerror=error=>{clearTimeout(timer);e(error);}; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  return {
    eval: (expression) => new Promise((resolve, reject) => {
      const myId = ++id;
      const timer=setTimeout(()=>{pending.delete(myId);reject(new Error('CDP evaluation timeout'));},15000);
      pending.set(myId, (d) => {clearTimeout(timer);return d.result && d.result.exceptionDetails
        ? reject(new Error(JSON.stringify(d.result.exceptionDetails.exception || d.result.exceptionDetails)))
        : resolve(d.result && d.result.result && d.result.result.value);});
      ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    }),
    close: () => ws.close()
  };
}

// ---------------------------------------------------------------- scenarios

// ~2 s of "speech" delivered in real time (43 ms blocks), then the VAD end event.
const SPEAK = (seconds) => `(async () => {
  const st = speechStream('system');
  st.start(48000);
  const blocks = Math.round(${seconds} * 48000 / 2048);
  for (let i = 0; i < blocks; i++) { st.push(new Float32Array(2048).fill(0.1)); await new Promise(r => setTimeout(r, 43)); }
  window.__endAt = Date.now();
  st.end(blocks * 2048, ${seconds});
})()`;

const RESET = `(() => { if (abortAnswer) abortAnswer(); answerSeq++; resetSpec(); state.answering = false; state.lastAnswerAt = 0; state.transcript = []; document.querySelector('#transcript').innerHTML = ''; liveEls.them = liveEls.me = null; document.querySelector('#answerText').textContent = ''; document.querySelector('#ansMeta').textContent = ''; return true; })()`;

let failed = 0;
const check = (name, cond, extra) => { if (!cond) failed++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '   ' + extra : '')); };

async function run() {
  await new Promise((r) => sttSrv.listen(0, '127.0.0.1', r));
  await new Promise((r) => llmSrv.listen(0, '127.0.0.1', r));
  const sttPort = sttSrv.address().port, llmPort = llmSrv.address().port;

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'livedesk-test-'));
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    llm: { baseUrl: 'http://127.0.0.1:' + llmPort + '/v1', model: 'mock', maxTokens: 350 },
    stt: { baseUrl: 'http://127.0.0.1:' + sttPort + '/v1', model: 'mock' },
    behavior: { autoAnswer: true, live: true }
  }));

  const debugPort = 9300 + Math.floor(Math.random() * 500);
  const electronBin = require('electron');
  const extra = (process.env.ELECTRON_EXTRA_ARGS || '').split(/\s+/).filter(Boolean);
  const app = spawn(electronBin, [path.join(__dirname, '..'), '--disable-gpu', '--user-data-dir=' + userData, '--remote-debugging-port=' + debugPort, ...extra], { stdio: 'ignore' });
  const cleanup = () => { try { app.kill(); } catch (_) {} sttSrv.close(); llmSrv.close(); };
  process.on('exit', cleanup);

  const page = await cdp(debugPort);
  await sleep(1200);                                  // let init + backend probe finish
  log.llm.length = 0;                                 // ignore the startup health ping

  // ---- A: early answer
  console.log('\n— A: question answered while still being asked —');
  await page.eval(RESET); interimCount = 0; log.sttFinalDone.length = 0; log.llm.length = 0;
  scenario = { interim: ['what would you say', 'What would you say is your biggest strength?', 'What would you say is your biggest strength?'], final: 'What would you say is your biggest strength?' };
  const tStart = now();
  const speaking = page.eval(SPEAK(2.2));
  let sawLive = false;
  for (let i = 0; i < 40 && !sawLive; i++) {
    await sleep(100);
    sawLive = await page.eval(`!!document.querySelector('#transcript .line.live .txt') && document.querySelector('#transcript .line.live .txt').textContent.length > 0`);
  }
  await speaking;
  await sleep(1500);                                   // final + stream completes
  const endAt = await page.eval('window.__endAt');
  check('D: live caption appeared while still speaking', sawLive);
  check('A: exactly one LLM request for this question', log.llm.length === 1, 'n=' + log.llm.length);
  const e = log.llm[0] || {};
  const startedBeforeFinal = e.at && log.sttFinalDone[0] && e.at < log.sttFinalDone[0];
  check('A: LLM request started BEFORE the final transcript returned', startedBeforeFinal,
    e.at ? 'LLM started ' + (log.sttFinalDone[0] - e.at) + ' ms before the final transcript' : '');
  check('A: LLM request started before the speaker even finished', e.at && endAt && e.at < endAt,
    e.at ? (e.at - tStart) + ' ms after speech began vs. ' + (endAt - tStart) + ' ms speech length' : '');
  check('A: early answer NOT restarted when the final confirmed it', log.llmClosed === 0);
  const ans = await page.eval(`document.querySelector('#answerText').textContent`);
  const meta = await page.eval(`document.querySelector('#ansMeta').textContent`);
  check('A: full answer rendered, no caret char in copyable text', /clear communication$/.test(ans) && !ans.includes('\u258d'), JSON.stringify(ans.slice(-30)));
  check('A: meta keeps early + first-word latency AND shows total', /early/.test(meta) && /first word/.test(meta) && /total/.test(meta), JSON.stringify(meta));
  const lines = await page.eval(`Array.from(document.querySelectorAll('#transcript .line')).map(l => (l.classList.contains('live') ? 'LIVE:' : '') + l.querySelector('.txt').textContent)`);
  check('D: live caption replaced by exactly one final line', lines.length === 1 && !lines[0].startsWith('LIVE:'), JSON.stringify(lines));

  // ---- B: final differs → early answer replaced
  console.log('\n— B: question changes before it ends —');
  await page.eval(RESET); interimCount = 0; log.sttFinalDone.length = 0; log.llm.length = 0; log.llmClosed = 0;
  llmTokenMs = 250;          // ~4.5 s answer: still streaming when the corrected final lands
  await sleep(200);
  scenario = { interim: ['what is your biggest strength?', 'what is your biggest strength?', 'what is your biggest strength?'],
    final: 'What is your biggest strength, and how did it help on your last big project at work?' };
  await page.eval(SPEAK(2.2));
  await sleep(1800);
  check('B: second (corrected) LLM request issued', log.llm.length === 2, 'n=' + log.llm.length);
  check('B: superseded early answer was aborted', log.llmClosed >= 1, 'aborted=' + log.llmClosed);
  check('B: final answer is for the full question', (log.llm[1] || {}).question === scenario.final, JSON.stringify((log.llm[1] || {}).question));

  llmTokenMs = 45;

  // ---- C: statement → no answer
  console.log('\n— C: statements are not answered —');
  await page.eval(RESET); interimCount = 0; log.llm.length = 0;
  await sleep(200);
  scenario = { interim: ['so we shipped the release on tuesday'], final: 'So we shipped the release on Tuesday.' };
  await page.eval(SPEAK(2.0));
  await sleep(900);
  check('C: no LLM request for a non-question', log.llm.length === 0, 'n=' + log.llm.length);
  const lines2 = await page.eval(`document.querySelectorAll('#transcript .line:not(.live)').length`);
  check('C: statement still lands in the transcript', lines2 === 1, 'lines=' + lines2);

  page.close();
  cleanup();
  console.log(failed ? '\n' + failed + ' CHECK(S) FAILED' : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('test crashed:', e); process.exit(2); });
