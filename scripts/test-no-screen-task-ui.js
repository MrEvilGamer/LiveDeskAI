'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const notice = 'No question found on this screen. Bring the question into view and try Current screen again, or use Answer beside a transcript entry.';
function harness(response = { ok: false, category: 'NO_TASK', text: '', recognizedText: 'PRIVATE OCR browser toolbar', diagnostics: { category: 'NO_TASK', stages: [] } }) {
  const nodes = new Map();
  function node(selector) {
    if (!nodes.has(selector)) {
      const classes = new Set();
      const attributes = new Map();
      nodes.set(selector, {
        textContent: '', value: '', hidden: false, disabled: false, checked: false,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
        addEventListener() {}, removeAttribute(name) { attributes.delete(name); delete this[name]; },
        getAttribute: name => attributes.get(name) ?? null,
        querySelector: name => node(selector + ' ' + name)
      });
    }
    return nodes.get(selector);
  }
  const clock = { now: 100000 };
  const api = {
    captures: 0, reads: 0, image: 'synthetic-screen', response,
    cancelVision: async () => {},
    screenCapture: async () => { api.captures++; return { ok: true, image: api.image, width: 1000, height: 800, displayLabel: 'synthetic display' }; },
    visionRead: async () => { api.reads++; return api.response; }
  };
  const ctx = vm.createContext({
    window: { liveDesk: api }, location: { search: '' }, document: { querySelector: node },
    performance, Date: class extends Date { static now() { return clock.now; } },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, cancelAnimationFrame() {},
    answers: [], scheduled: [], notifications: [], clock
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/overlay.js'), 'utf8').replace('\ninit();', '\n'), ctx);
  vm.runInContext(`
    cfg = { llm: { model: 'fixture', baseUrl: 'local' }, screen: { model: 'fixture', autoAnswer: true }, behavior: { autoAnswer: false } };
    state.screenOn = true;
    toast = (message, error) => notifications.push({ message, error });
    addLine = () => {};
    startAnswer = (question, options) => answers.push({ question, options });
    scheduleAnswer = question => scheduled.push(question);
  `, ctx);
  return { ctx, node, api, clock, run: expression => vm.runInContext(expression, ctx) };
}

function assertNeutral(h) {
  assert.equal(h.node('#answerText').textContent, notice);
  assert.equal(h.node('#ansMeta').textContent, 'No question found');
  assert.equal(h.ctx.notifications.length, 0, 'an ordinary page without a question must not show failure toasts');
  assert.equal(h.ctx.answers.length, 0);
  assert.equal(h.ctx.scheduled.length, 0, 'no-task results must never start a model answer');
  assert.equal(h.node('#captureText').textContent, '', 'OCR stays private with Debug disabled');
  assert.equal(h.node('#captureText').hidden, true);
  assert.equal(h.node('#captureImage').getAttribute('src'), null);
  assert.equal(h.node('#captureImage').hidden, true);
  assert.doesNotMatch(h.node('#answerText').textContent, /PRIVATE OCR|UNSUPPORTED_CONTENT|failed/i);
}

(async () => {
  const manual = harness();
  manual.run(`lastScreenText = 'Old screen question?'; state.lastQuestion = lastScreenText; state.transcript = [{ speaker: 'screen', text: lastScreenText, at: clock.now }];`);
  await manual.run('answerCurrentScreen()');
  assertNeutral(manual);
  assert.equal(manual.node('#btnCurrentScreen').textContent, 'Current screen');
  assert.equal(manual.node('#btnCurrentScreen').disabled, false);
  assert.equal(manual.run('latestQuestion()'), '', 'a no-task result must not reuse the previous screen task');
  assert.equal(manual.run('lastScreenText || latestScreenImage'), '');

  // Users can still choose an already captured transcript question or type Ask.
  manual.run(`
    state.transcript = [{ speaker: 'them', text: 'What is dynamic programming?', at: clock.now }];
    answerTranscriptEntry(document.querySelector('#selectedLine'), state.transcript[0]);
  `);
  assert.equal(manual.ctx.answers[0].question, 'What is dynamic programming?');
  assert.equal(manual.ctx.answers[0].options.textOnly, true);
  manual.node('#askBox').value = 'Explain a binary search tree.';
  manual.run('submitAsk()');
  assert.equal(manual.ctx.answers[1].question, 'Explain a binary search tree.');
  assert.equal(manual.node('#askBox').value, '');

  const periodic = harness();
  await periodic.run('screenTick()');
  assertNeutral(periodic);
  periodic.clock.now += 1000;
  await periodic.run('screenTick()');
  assert.equal(periodic.api.captures, 2, 'changed screens remain discoverable');
  assert.equal(periodic.api.reads, 1, 'unchanged no-task frames must not resubmit expensive extraction every second');
  assert.equal(periodic.ctx.notifications.length, 0);
  periodic.clock.now += 30000;
  await periodic.run('screenTick()');
  assert.equal(periodic.api.reads, 2, 'no-task cache expires to permit another read');
  periodic.api.image = 'question-now-visible';
  periodic.api.response = { ok: true, text: 'What is a queue?', method: 'Local OCR' };
  await periodic.run('screenTick()');
  assert.equal(periodic.api.reads, 3);
  assert.deepEqual(Array.from(periodic.ctx.scheduled), ['What is a queue?']);

  const returning = harness({ ok: true, text: 'What is a queue?', method: 'Local OCR' });
  returning.api.image = 'question-A';
  await returning.run('screenTick()');
  returning.api.image = 'ordinary-page-B';
  returning.api.response = { ok: false, category: 'NO_TASK' };
  await returning.run('screenTick()');
  assert.equal(returning.run('lastProcessedCapture'), null);
  assert.equal(returning.run('lastProcessedScreenImage'), '');
  returning.api.image = 'question-A';
  returning.api.response = { ok: true, text: 'What is a queue?', method: 'Local OCR' };
  await returning.run('screenTick()');
  assert.equal(returning.api.reads, 3, 'returning to an earlier question after a no-task page must extract it again');
  assert.deepEqual(Array.from(returning.ctx.scheduled), ['What is a queue?', 'What is a queue?']);
  await returning.run('screenTick()');
  assert.equal(returning.api.reads, 3, 'a repeated current question still uses the normal successful-frame cache');

  const changedModel = harness();
  await changedModel.run('screenTick()');
  changedModel.run("cfg.screen.model = 'different-vision-model';");
  await changedModel.run('screenTick()');
  assert.equal(changedModel.api.reads, 2, 'model changes must not inherit the previous model no-task frame');

  const streaming = harness();
  streaming.run("state.answering = true; lastScreenText = 'Current question?'; state.lastQuestion = lastScreenText; lastAnswerRaw = 'Answer still streaming';");
  streaming.node('#answerText').textContent = 'Answer still streaming';
  streaming.node('#ansMeta').textContent = 'First word 0.4s';
  await streaming.run('screenTick()');
  assert.equal(streaming.node('#answerText').textContent, 'Answer still streaming');
  assert.equal(streaming.node('#ansMeta').textContent, 'First word 0.4s');
  assert.equal(streaming.run('lastAnswerRaw'), 'Answer still streaming');
  assert.equal(streaming.run('state.lastQuestion'), 'Current question?', 'active answer history must retain its question');
  assert.equal(streaming.ctx.notifications.length, 0);

  const selected = harness();
  selected.run(`
    state.selectedTranscriptEntry = { speaker: 'them', text: 'What is a queue?', at: clock.now };
    state.lastQuestion = state.selectedTranscriptEntry.text;
    lastScreenText = state.lastQuestion;
    lastAnswerRaw = 'A queue processes items in first-in, first-out order.';
  `);
  selected.node('#answerText').textContent = 'A queue processes items in first-in, first-out order.';
  selected.node('#screenQuestion').textContent = 'Selected question: What is a queue?';
  selected.node('#screenQuestion').hidden = false;
  selected.node('#ansMeta').textContent = '1.0s total';
  await selected.run('screenTick()');
  assert.equal(selected.node('#answerText').textContent, 'A queue processes items in first-in, first-out order.');
  assert.equal(selected.node('#screenQuestion').textContent, 'Selected question: What is a queue?');
  assert.equal(selected.node('#screenQuestion').hidden, false);
  assert.equal(selected.node('#ansMeta').textContent, '1.0s total');
  assert.equal(selected.run('state.lastQuestion'), 'What is a queue?');
  assert.equal(selected.run('lastAnswerRaw'), 'A queue processes items in first-in, first-out order.');
  assert.equal(selected.run('lastScreenText'), '', 'stale screen context is still invalidated when preserving a selected answer');
  assert.equal(selected.ctx.notifications.length, 0);
  await selected.run('answerCurrentScreen()');
  assert.equal(selected.run('state.selectedTranscriptEntry'), null, 'explicit Current screen supersedes the old selection');
  assert.equal(selected.node('#answerText').textContent, notice, 'an explicit no-task capture shows guidance instead of leaving stale reading status');

  for (const text of ['', 'NO_TASK', 'NO_TASK.']) {
    const legacy = harness({ ok: true, text });
    await legacy.run('answerCurrentScreen()');
    assertNeutral(legacy);
    const legacyPeriodic = harness({ ok: true, text });
    await legacyPeriodic.run('screenTick()');
    assertNeutral(legacyPeriodic);
  }

  const unsupported = harness({ ok: false, category: 'UNSUPPORTED_CONTENT', error: 'This model does not support images.' });
  await unsupported.run('answerCurrentScreen()');
  assert.match(unsupported.node('#answerText').textContent, /^UNSUPPORTED_CONTENT:/);
  assert.equal(unsupported.node('#ansMeta').textContent, 'Screen request failed');
  assert.ok(unsupported.ctx.notifications.some(item => item.error));

  console.log('PASS neutral manual/periodic no-question state, unchanged-frame suppression and recovery, no unwanted answers/toast spam, private debug defaults, active answer preservation, transcript/Ask independence, legacy NO_TASK handling, and genuine unsupported-model errors');
})().catch(error => { console.error(error); process.exitCode = 1; });
