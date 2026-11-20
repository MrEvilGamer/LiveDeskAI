const { app, BrowserWindow } = require('electron');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

app.commandLine.appendSwitch('disable-gpu');
const packaged = process.argv.includes('--packaged');
const root = packaged
  ? path.resolve(__dirname, '../dist/win-unpacked/resources/app.asar')
  : path.resolve(__dirname, '..');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 440,
    height: 680,
    webPreferences: { backgroundThrottling: false }
  });
  const evaluate = expression => win.webContents.executeJavaScript(expression);
  try {
    await win.loadFile(path.join(root, 'src/overlay.html'));
    await win.webContents.insertCSS('body.demo { padding: 0 !important; } .line { animation: none !important; }');
    await evaluate(`(() => {
      cfg = {
        llm: { baseUrl: 'http://localhost:11434/v1', model: 'synthetic-vision', maxTokens: 400 },
        behavior: { mode: 'interview', autoAnswer: false, live: false, verbosity: 'short', context: '' },
        screen: { model: 'synthetic-vision', autoAnswer: false },
        overlay: { stealth: true, opacity: 1 }
      };
      state.listening = false;
      state.answering = false;
      state.answerHistory = [];
      state.transcript = [];
      state.lastQuestion = '';
      state.lastAnswerAt = 0;
      document.querySelector('#transcript').replaceChildren();
      liveEls.them = liveEls.me = null;
      window.__requests = [];
      window.__prepared = [];
      window.__realBuildMessages = buildMessages;
      buildMessages = function(config, transcript, question, history) {
        __prepared.push({ question, transcript: transcript.map(entry => ({ ...entry })), history: history.map(turn => ({ ...turn })) });
        return __realBuildMessages(config, transcript, question, history);
      };
      askLLM = function(config, messages, token, done, error) {
        const request = { messages, token, done, error, aborted: false };
        __requests.push(request);
        return () => { request.aborted = true; };
      };
      const t = Date.now() - 10000;
      window.__entries = [
        { speaker: 'me', text: 'I build graphics tools and enjoy making games.', at: t },
        { speaker: 'them', text: 'What are your hobbies? And why is C++ programming your forte?', at: t + 1000 },
        { speaker: 'them', text: 'How many children do you have? Are you married?', at: t + 2000 },
        { speaker: 'screen', text: 'What are your hobbies? And why is C++ programming your forte?', at: t + 3000 }
      ];
      state.transcript = __entries.slice();
      __entries.forEach(entry => addLine(entry.speaker, entry.text, entry));
      state.answerHistory = [
        { question: 'What did you work on?', answer: 'Graphics tools.', at: t + 500 },
        { question: 'Later unrelated question', answer: 'Later unrelated answer', at: t + 2500 }
      ];
      state.screenOn = true;
      latestScreenImage = 'data:image/png;base64,UNRELATED_SYNTHETIC_IMAGE';
      latestScreenAt = Date.now();
      setLive('them', 'A different question is still being transcribed');
      pendingQuestion = 'A queued automatic question must not replace the selection';
      spec.norm = 'an earlier speculative question';
      spec.lastNorm = spec.norm;
      document.querySelector('#autoAns').checked = false;
      return true;
    })()`);

    const controls = await evaluate(`(() => ({
      finals: document.querySelectorAll('#transcript .line:not(.live)').length,
      buttons: document.querySelectorAll('#transcript .line:not(.live) .line-answer').length,
      liveButtons: document.querySelectorAll('#transcript .line.live .line-answer').length,
      accessibleButtons: Array.from(document.querySelectorAll('.line-answer')).every(button =>
        button.tagName === 'BUTTON' && button.tabIndex >= 0 &&
        (button.getAttribute('aria-label') || button.textContent).trim().length > 0)
    }))()`);
    assert.equal(controls.buttons, controls.finals, 'Each final entry has an Answer button');
    assert.equal(controls.liveButtons, 0, 'Unfinished captions have no unstable Answer target');
    assert.equal(controls.accessibleButtons, true, 'Answer controls are keyboard-focusable native buttons');

    const selected = await evaluate(`(() => {
      document.querySelectorAll('#transcript .line:not(.live) .line-answer')[1].click();
      return {
        requests: __requests.length,
        prepared: __prepared.at(-1),
        messages: __requests.at(-1).messages,
        question: state.lastQuestion,
        pendingQuestion,
        speculative: spec.norm,
        selected: document.querySelectorAll('#transcript .line.selected').length,
        selectedText: document.querySelector('#transcript .line.selected .txt')?.textContent,
        source: document.querySelector('#screenQuestion').textContent,
        sourceHidden: document.querySelector('#screenQuestion').hidden,
        auto: cfg.behavior.autoAnswer
      };
    })()`);
    const hobbies = 'What are your hobbies? And why is C++ programming your forte?';
    assert.equal(selected.requests, 1, 'Click answers immediately with Auto disabled');
    assert.equal(selected.auto, false, 'Manual answering does not change the Auto preference');
    assert.equal(selected.question, hobbies);
    assert.equal(selected.prepared.question, hobbies);
    assert.equal(selected.pendingQuestion, '', 'Previously queued automatic work is removed');
    assert.equal(selected.speculative, '', 'Speculative answering state cannot hijack this click');
    assert.equal(selected.selected, 1);
    assert.equal(selected.selectedText, hobbies);
    assert.equal(selected.sourceHidden, false);
    assert.match(selected.source, /Selected question/i);
    assert.ok(selected.source.includes(hobbies));
    assert.equal(typeof selected.messages.at(-1).content, 'string', 'Speech selection never inherits an unrelated screenshot');
    assert.deepEqual(selected.prepared.transcript.map(entry => entry.text), [
      'I build graphics tools and enjoy making games.',
      hobbies
    ], 'Context stops at the selected occurrence, even if a later screen entry repeats its text');
    assert.ok(!selected.prepared.transcript.some(entry => /married|children/.test(entry.text)), 'Newer unrelated transcript is excluded');
    assert.deepEqual(selected.prepared.history.map(turn => turn.question), ['What did you work on?'], 'Earlier answer history is retained and later turns are excluded');
    assert.ok(selected.prepared.transcript.some(entry => /graphics tools/.test(entry.text)), 'Earlier useful conversation remains available');
    const queuedDuringSelection = await evaluate(`(() => {
      scheduleAnswer('A newly detected automatic question');
      return { pending: pendingQuestion, requests: __requests.length };
    })()`);
    assert.equal(queuedDuringSelection.pending, '', 'Automatic questions cannot immediately replace the explicitly selected answer');
    assert.equal(queuedDuringSelection.requests, 1);
    console.log('PASS final transcript buttons answer the exact selected entry with Auto off and appropriate prior context');

    const superseded = await evaluate(`(() => {
      document.querySelectorAll('#transcript .line:not(.live) .line-answer')[2].click();
      __requests[0].token('STALE ANSWER THAT MUST NOT APPEAR');
      __requests[0].done('STALE ANSWER THAT MUST NOT APPEAR', false);
      __requests[1].token('Please share the relevant personal details.');
      __requests[1].done('Please share the relevant personal details.', false);
      return {
        requests: __requests.length,
        oldAborted: __requests[0].aborted,
        question: state.lastQuestion,
        selectedCount: document.querySelectorAll('#transcript .line.selected').length,
        selectedText: document.querySelector('#transcript .line.selected .txt')?.textContent,
        remembered: state.answerHistory.map(turn => turn.answer)
      };
    })()`);
    assert.equal(superseded.requests, 2);
    assert.equal(superseded.oldAborted, true);
    assert.equal(superseded.selectedCount, 1);
    assert.equal(superseded.selectedText, 'How many children do you have? Are you married?');
    assert.equal(superseded.question, superseded.selectedText);
    assert.ok(!superseded.remembered.some(answer => /STALE ANSWER/.test(answer)), 'Superseded output is not saved');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await evaluate('document.querySelector("#answerText").textContent'), 'Please share the relevant personal details.');
    console.log('PASS selecting another entry cancels the previous request and rejects late answer callbacks');

    const redo = await evaluate(`(() => {
      document.querySelector('#btnRegen').click();
      return { count: __requests.length, question: __prepared.at(-1).question, source: document.querySelector('#screenQuestion').textContent };
    })()`);
    assert.equal(redo.count, 3);
    assert.equal(redo.question, superseded.question, 'Redo answers the selected question even while a newer partial is visible');
    assert.match(redo.source, /Selected question/i);
    const repeat = await evaluate(`(() => {
      document.querySelectorAll('#transcript .line:not(.live) .line-answer')[2].click();
      return { count: __requests.length, question: __prepared.at(-1).question };
    })()`);
    assert.equal(repeat.count, 4, 'Repeated manual clicks bypass the automatic answer cooldown');
    assert.equal(repeat.question, superseded.question);
    console.log('PASS Redo and repeated clicks retain the explicit question instead of answering the latest caption');

    for (const width of [440, 300]) {
      win.setSize(width, 680);
      const geometry = await evaluate(`(() => {
        document.querySelector('#transcript .line.selected').scrollIntoView({ block: 'center' });
        const host = document.querySelector('#transcript');
        const bounds = host.getBoundingClientRect();
        return {
          overflow: host.scrollWidth > host.clientWidth + 1,
          buttonsInBounds: Array.from(host.querySelectorAll('.line-answer')).every(button => {
            const rect = button.getBoundingClientRect();
            return rect.width > 0 && rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
          })
        };
      })()`);
      assert.equal(geometry.overflow, false, `Transcript has no horizontal overflow at ${width}px`);
      assert.equal(geometry.buttonsInBounds, true, `Answer buttons remain visible at ${width}px`);
    }
    console.log('PASS transcript Answer buttons stay inside the panel at normal and minimum widths');

    win.setSize(440, 680);
    await evaluate(`(() => {
      __requests.at(-1).done('Please share the relevant personal details.', false);
      setLive('them', '');
      document.querySelector('#transcript .line.selected').scrollIntoView({ block: 'center' });
    })()`);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const output = path.resolve(__dirname, '../benchmarks/transcript-answer');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, packaged ? 'preview-packaged.png' : 'preview.png'), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG());

    const noQuestion = await evaluate(`(() => {
      state.selectedTranscriptEntry = null;
      state.answering = false;
      if (selectedTranscriptLine) {
        selectedTranscriptLine.classList.remove('selected');
        selectedTranscriptLine = null;
      }
      state.lastQuestion = lastScreenText = 'An old screen question';
      pendingQuestion = lastScreenText;
      noScreenTask({ image: 'synthetic-no-question-frame', width: 1280, height: 720 });
      const footer = document.querySelector('footer').getBoundingClientRect();
      return {
        text: document.querySelector('#answerText').textContent,
        meta: document.querySelector('#ansMeta').textContent,
        sourceHidden: document.querySelector('#screenQuestion').hidden,
        thinking: document.querySelector('#answerCard').classList.contains('thinking'),
        errorToast: document.querySelector('#toast').classList.contains('err'),
        footerBottom: footer.bottom,
        viewportHeight: innerHeight,
        pendingQuestion,
        lastQuestion: state.lastQuestion
      };
    })()`);
    assert.match(noQuestion.text, /^No question found on this screen\./);
    assert.match(noQuestion.text, /Answer beside a transcript entry/);
    assert.equal(noQuestion.meta, 'No question found');
    assert.equal(noQuestion.sourceHidden, true, 'The neutral state removes the previous source question');
    assert.equal(noQuestion.thinking, false, 'No-task classification is a completed neutral state');
    assert.equal(noQuestion.errorToast, false, 'No-task classification does not produce an error toast');
    assert.ok(!/MODEL_TIMEOUT|VISION_OCR_FAILURE|UNSUPPORTED_CONTENT|failed/i.test(noQuestion.text));
    assert.equal(noQuestion.lastQuestion, '', 'Stale screen questions are not left as Redo targets');
    assert.equal(noQuestion.pendingQuestion, '', 'Stale screen questions are removed from the automatic queue');
    assert.ok(noQuestion.footerBottom <= noQuestion.viewportHeight + 1, 'The footer stays inside the viewport');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output, packaged ? 'no-question-preview-packaged.png' : 'no-question-preview.png'), (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG());
    console.log('PASS no-question screen state gives neutral guidance with no model error and keeps footer controls visible');
    console.log(`PASS transcript Answer regression suite (${packaged ? 'packaged' : 'source'})`);
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win.destroy();
    app.exit(1);
  }
});
