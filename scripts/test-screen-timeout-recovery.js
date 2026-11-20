'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createReader } = require('../screen-pipeline');

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Screen read stayed pending after its deadline')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

function overlayHarness() {
  const nodes = new Map();
  function node(selector) {
    if (!nodes.has(selector)) {
      const classes = new Set();
      nodes.set(selector, {
        textContent: '', hidden: false, disabled: false, checked: false,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
        addEventListener() {}, removeAttribute() {}, querySelector() { return null; }
      });
    }
    return nodes.get(selector);
  }
  const clock = { now: 100000 };
  const api = {
    captures: 0, reads: 0,
    response: { ok: false, category: 'MODEL_TIMEOUT', error: 'Model timeout: The screen reader exceeded its deadline.', retryAfterMs: 20000 },
    screenCapture: async () => { api.captures++; return { ok: true, image: 'synthetic screen', width: 1000, height: 800 }; },
    visionRead: async () => { api.reads++; if (api.failure) throw api.failure; return api.response; },
    cancelVision: async () => {}
  };
  const ctx = vm.createContext({
    window: { liveDesk: api }, location: { search: '' }, document: { querySelector: node },
    performance, Date: class extends Date { static now() { return clock.now; } },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, cancelAnimationFrame() {},
    answers: [], scheduled: [], clock
  });
  const source = fs.readFileSync(path.join(__dirname, '../src/overlay.js'), 'utf8');
  vm.runInContext(source.replace('\ninit();', '\n'), ctx);
  vm.runInContext(`
    cfg = { llm: { model: 'fixture' }, screen: { model: 'fixture', autoAnswer: true, intervalSec: 1 }, behavior: { autoAnswer: false } };
    state.screenOn = true;
    toast = () => {};
    showCapturePreview = () => {};
    addLine = () => {};
    startAnswer = (question, options) => answers.push({ question, options });
    scheduleAnswer = question => scheduled.push(question);
  `, ctx);
  return { ctx, node, api, clock, run: expression => vm.runInContext(expression, ctx) };
}

async function testOverlayRecovery() {
  const h = overlayHarness();
  await bounded(h.run('screenTick()'));
  assert.equal(h.node('#ansMeta').textContent, 'Screen read timed out · retrying shortly');
  assert.equal(h.node('#answerText').textContent, 'MODEL_TIMEOUT: Model timeout: The screen reader exceeded its deadline.');
  assert.equal(h.run('screenRetryAt'), h.clock.now + 20000);
  assert.equal(h.run('screenBusy || screenCapturing'), false);
  h.clock.now += 19999;
  await bounded(h.run('screenTick()'));
  assert.equal(h.api.captures, 1, 'polling must not capture during the retry delay');
  assert.equal(h.api.reads, 1, 'polling must not submit another vision request during retry delay');

  // The screen cooldown must never prevent a manual answer to a captured transcript.
  h.run(`
    state.transcript = [{ speaker: 'them', text: 'What is dynamic programming?', at: clock.now - 1 }];
    answerTranscriptEntry(document.querySelector('#selectedLine'), state.transcript[0]);
  `);
  assert.equal(h.ctx.answers.length, 1);
  assert.equal(h.ctx.answers[0].question, 'What is dynamic programming?');
  assert.equal(h.ctx.answers[0].options.textOnly, true);

  h.api.response = { ok: true, text: 'What is a queue?', method: 'Local OCR' };
  h.clock.now++;
  await bounded(h.run('screenTick()'));
  assert.equal(h.api.captures, 2);
  assert.deepEqual(Array.from(h.ctx.scheduled), ['What is a queue?'], 'automatic screen answers resume after cooldown');

  const thrown = overlayHarness();
  thrown.api.failure = Object.assign(new Error('The local screen model timed out.'), { category: 'MODEL_TIMEOUT' });
  await bounded(thrown.run('screenTick()'));
  assert.equal(thrown.node('#ansMeta').textContent, 'Screen read timed out · retrying shortly');
  assert.equal(thrown.run('screenRetryAt'), thrown.clock.now + 15000);
  await bounded(thrown.run('screenTick()'));
  assert.equal(thrown.api.captures, 1);

  const manual = overlayHarness();
  manual.api.failure = Object.assign(new Error('The local screen model timed out.'), { category: 'MODEL_TIMEOUT' });
  await bounded(manual.run('answerCurrentScreen()'));
  assert.equal(manual.run('screenRetryAt'), manual.clock.now + 15000, 'manual thrown timeouts also pause automatic reads');
  assert.equal(manual.node('#btnCurrentScreen').disabled, false);
  assert.equal(manual.node('#btnCurrentScreen').textContent, 'Current screen');
  assert.doesNotMatch(manual.node('#ansMeta').textContent, /reading|capturing/i);
  await bounded(manual.run('screenTick()'));
  assert.equal(manual.api.captures, 1);

  const streaming = overlayHarness();
  streaming.run('state.answering = true;');
  streaming.node('#answerText').textContent = 'Answer already streaming';
  streaming.node('#ansMeta').textContent = 'Streaming draft';
  await bounded(streaming.run('screenTick()'));
  assert.equal(streaming.node('#answerText').textContent, 'Answer already streaming');
  assert.equal(streaming.node('#ansMeta').textContent, 'Streaming draft');
  assert.equal(streaming.run('state.answering'), true);

  h.run('screenRetryAt = clock.now + 15000; toggleScreenReading(); screenTick = () => {}; toggleScreenReading();');
  assert.equal(h.run('screenRetryAt'), 0, 'explicitly turning screen reading on clears its old cooldown');
}

(async () => {
  let reads = 0, calls = 0, timedSignal;
  const reader = createReader({
    timeoutMs: 15,
    retryDelayMs: 1000,
    ocr: async () => { reads++; return { text: 'Review the code below.', backend: 'Local OCR' }; },
    // Reproduce an adapter that never rejects, even when its signal is aborted.
    vision: (_req, signal) => { calls++; timedSignal = signal; return new Promise(() => {}); }
  });
  const request = { image: 'same frame', model: 'slow-model', baseUrl: 'local', requestId: 'first' };
  const first = await bounded(reader.read(request));
  assert.equal(first.category, 'MODEL_TIMEOUT');
  assert.equal(first.ok, false);
  assert.ok(timedSignal.aborted, 'deadline must cancel underlying work');
  assert.equal(first.recognizedText, 'Review the code below.');
  assert.equal(first.method, 'Local OCR');
  assert.equal(first.retryAfterMs, 1000);
  const cached = await bounded(reader.read({ ...request, requestId: 'retry' }));
  assert.equal(cached.category, 'MODEL_TIMEOUT');
  assert.equal(cached.requestId, 'retry');
  assert.ok(cached.diagnostics.cacheHit);
  assert.ok(cached.retryAfterMs > 0 && cached.retryAfterMs <= 1000);
  assert.equal(reads, 1, 'unchanged timeout frame must not rerun OCR');
  assert.equal(calls, 1, 'unchanged timeout frame must not resubmit vision');
  await bounded(reader.read({ ...request, model: 'different-model' }));
  assert.equal(calls, 2, 'changing model must allow recovery immediately');
  await bounded(reader.read({ ...request, image: 'new frame' }));
  assert.equal(calls, 3, 'a changed screen must not inherit a timeout');
  await new Promise(resolve => setTimeout(resolve, 1010));
  await bounded(reader.read(request));
  assert.equal(calls, 4, 'a timed-out frame becomes eligible after the cooldown');

  let visionStarted, releaseLate;
  const entered = new Promise(resolve => { visionStarted = resolve; });
  const cancelled = createReader({
    timeoutMs: 10000,
    ocr: async () => ({ text: 'Review the code below.' }),
    vision: (_req, signal) => { visionStarted(signal); return new Promise(resolve => { releaseLate = resolve; }); }
  });
  const pending = cancelled.read({ image: 'cancel', requestId: 'cancel' });
  const cancelSignal = await entered;
  cancelled.cancel('cancel');
  assert.equal((await bounded(pending)).category, 'CANCELLED');
  assert.ok(cancelSignal.aborted);
  releaseLate('What is a queue?');

  let unneededVision = 0;
  const adequateOcr = createReader({
    timeoutMs: 15,
    ocr: async () => ({ text: 'What is a queue?' }),
    vision: () => { unneededVision++; return new Promise(() => {}); }
  });
  const answerable = await bounded(adequateOcr.read({ image: 'readable question' }));
  assert.ok(answerable.ok, 'complete OCR stays usable while the vision model is unavailable');
  assert.equal(unneededVision, 0);
  assert.equal(answerable.text, 'What is a queue?');

  await testOverlayRecovery();

  console.log('PASS stalled vision deadline, abort propagation, unchanged-frame cooldown, model/frame recovery, cancellation, complete OCR bypass, incomplete OCR safety, periodic/manual timeout status and backoff, automatic recovery, transcript answers during backoff, and active answer preservation');
})().catch(error => { console.error(error); process.exitCode = 1; });
