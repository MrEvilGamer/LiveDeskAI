const assert = require('assert/strict');
const { analyze, createReader } = require('../screen-pipeline');

const rows = text => text.split('\n').map((line, index) => ({
  text: line,
  x: 20,
  y: 50 + index * 24,
  height: 18,
  confidence: 0.99
}));

// These are synthetic questions modelled on ordinary spoken and on-screen
// interview prompts. They do not reproduce the user's original visible page.
const questions = [
  'Who created C++',
  'When would you use a vector instead of a linked list',
  'Where do you store the assets for your game',
  'Are you married',
  'Do you have children',
  'Did you write the renderer yourself',
  'Does your project use a database',
  'Is C++ your preferred programming language',
  'Have you worked with graphics programming',
  'Can you introduce yourself',
  'Could you introduce yourself',
  'Would you introduce yourself',
  'Will you introduce yourself',
  'Introduce yourself',
  'Walk me through your graphics project',
  'Name three standard library containers',
  'Share your recent project experience',
  'Hello',
  'Hi',
  'Good morning',
  'How are you',
  'Interviewer: Who created C++',
  'Question 2: Could you introduce yourself',
  '2. Are you married',
  'Tell us about yourself',
  'Give an example of recursion'
];

async function main() {
  for (const question of questions) {
    const plain = analyze({ text: question });
    assert.equal(plain.category, null, `Recognize a question without punctuation: ${question}`);
    const positioned = analyze({ text: question, lines: rows(question) }, { width: 1280, height: 720 });
    assert.equal(positioned.category, null, `Recognize the same positioned OCR question: ${question}`);
    assert.ok(positioned.text.includes(question));
  }
  console.log('PASS questions, requests, introductions and greetings are recognized without requiring a question mark');

  let visionCalls = 0;
  for (const [index, question] of questions.entries()) {
    const reader = createReader({
      ocr: async () => ({ text: question, lines: rows(question), backend: 'Synthetic OCR' }),
      vision: async () => { visionCalls++; throw new Error('Complete OCR must not invoke vision'); }
    });
    const result = await reader.read({ requestId: `ocr-${index}`, image: `synthetic-ocr-${index}`, width: 1280, height: 720 });
    assert.equal(result.ok, true, `Complete OCR should answer directly: ${question}`);
    assert.equal(result.category, null);
    assert.equal(result.method, 'Synthetic OCR');
    assert.ok(!result.diagnostics.stages.some(stage => stage.stage === 'vision'));
  }
  assert.equal(visionCalls, 0, 'Complete short questions avoid vision latency');
  console.log('PASS complete question OCR bypasses vision rather than timing out during unnecessary image inference');

  let fallbackCalls = 0;
  for (const [index, question] of questions.entries()) {
    const reader = createReader({
      ocr: async () => ({ text: 'Unclear blurred lettering', lines: rows('Unclear blurred lettering') }),
      vision: async () => { fallbackCalls++; return question; }
    });
    const result = await reader.read({ requestId: `vision-${index}`, image: `synthetic-vision-${index}` });
    assert.equal(result.ok, true, `Vision extracts the same supported question: ${question}`);
    assert.equal(result.category, null);
    assert.equal(result.text, question);
    assert.equal(result.method, 'Vision + OCR');
  }
  assert.equal(fallbackCalls, questions.length);
  console.log('PASS vision-extracted questions follow the same intent classification as OCR');

  for (const text of [
    'Browser bookmarks and calendar',
    'Home Settings Notifications Search',
    'History Downloads Extensions',
    'File Edit View Help',
    'Pinned tabs Recent tabs',
    'Canary deployment dashboard',
    'Show more',
    'Hello\nHome Settings',
    'Dynamic Programming in C++'
  ]) {
    assert.equal(analyze({ text }).category, 'NO_TASK', `App chrome is not an answerable task: ${text}`);
    const reader = createReader({ ocr: async () => ({ text }), vision: async () => 'NO_TASK' });
    const result = await reader.read({ image: `chrome:${text}` });
    assert.equal(result.ok, false, 'No-task results cannot be passed as successful tasks');
    assert.equal(result.category, 'NO_TASK');
  }
  assert.equal(analyze({ text: '' }).category, 'NO_READABLE_CONTENT');
  const blank = createReader({
    ocr: async () => ({ text: '', blank: true }),
    vision: async () => { throw new Error('A blank image must not be invented into a question'); }
  });
  const empty = await blank.read({ image: 'synthetic-blank' });
  assert.equal(empty.ok, false);
  assert.equal(empty.category, 'NO_READABLE_CONTENT');
  assert.ok(!empty.diagnostics.stages.some(stage => stage.stage === 'vision'));
  const sentinel = createReader({ ocr: async () => ({ text: '' }), vision: async () => 'NO_TASK' });
  assert.equal((await sentinel.read({ image: 'synthetic-no-task' })).ok, false);
  const unsupported = createReader({
    ocr: async () => { throw new Error('Synthetic image decoder failure'); },
    vision: async () => { throw Object.assign(new Error('The configured backend does not support images'), { category: 'UNSUPPORTED_CONTENT' }); }
  });
  const unsupportedResult = await unsupported.read({ image: 'synthetic-unsupported-image' });
  assert.equal(unsupportedResult.ok, false);
  assert.equal(unsupportedResult.category, 'UNSUPPORTED_CONTENT', 'A backend capability failure remains distinct from having no question');
  console.log('PASS unrelated app chrome, blank images and NO_TASK responses never become successful questions');

  let noTaskOcrCalls = 0;
  let noTaskVisionCalls = 0;
  const noTaskCache = createReader({
    ocr: async () => { noTaskOcrCalls++; return { text: 'Home Settings Notifications Search' }; },
    vision: async () => { noTaskVisionCalls++; return 'NO_TASK'; }
  });
  const noTaskRequest = { image: 'synthetic-unchanged-menu', model: 'synthetic-vision' };
  const firstNoTask = await noTaskCache.read({ ...noTaskRequest, requestId: 'menu-first' });
  const secondNoTask = await noTaskCache.read({ ...noTaskRequest, requestId: 'menu-second' });
  assert.equal(firstNoTask.category, 'NO_TASK');
  assert.equal(secondNoTask.category, 'NO_TASK');
  assert.equal(secondNoTask.ok, false);
  assert.equal(secondNoTask.requestId, 'menu-second', 'Cached results keep the new request identity');
  assert.equal(secondNoTask.diagnostics.cacheHit, true, 'Unchanged no-task frame is cached within its retry window');
  assert.equal(noTaskOcrCalls, 1);
  assert.equal(noTaskVisionCalls, 1, 'Unchanged no-task frames do not repeat image inference on the next polling tick');
  console.log('PASS unchanged no-task frames reuse the classification cache without rerunning vision');

  for (const failure of ['transport', 'empty']) {
    let calls = 0;
    const reader = createReader({
      ocr: async () => ({ text: 'Home Settings Notifications Search' }),
      vision: async () => {
        calls++;
        if (failure === 'transport') throw new Error('Synthetic connection closed');
        return '   ';
      }
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await reader.read({ image: `synthetic-model-failure:${failure}`, model: 'synthetic-vision' });
      assert.equal(result.ok, false);
      assert.equal(result.category, 'VISION_OCR_FAILURE', `${failure} failures must not be masked as NO_TASK`);
      assert.equal(result.diagnostics.cacheHit, false, 'Model failures are not stored as no-task cache entries');
    }
    assert.equal(calls, 2, 'A model failure permits an immediate retry instead of reusing a false no-task result');
  }
  console.log('PASS vision transport errors and empty output remain model failures rather than no-task outcomes');

  for (const text of [
    'Review the code below.',
    'Explain the following Python implementation.',
    'Find the bug in the code shown below.',
    'const total = 0;'
  ]) {
    assert.equal(analyze({ text }).category, 'INCOMPLETE_TASK', `Missing instructions or code remain explicit: ${text}`);
    const reader = createReader({ ocr: async () => ({ text }), vision: async () => text });
    const result = await reader.read({ image: `incomplete:${text}` });
    assert.equal(result.ok, false);
    assert.equal(result.category, 'INCOMPLETE_TASK');
  }
  const omittedCode = createReader({
    ocr: async () => ({ text: 'Review this code.\nfunction render() {', lines: rows('Review this code.\nfunction render() {') }),
    vision: async () => 'Explain the graphics renderer'
  });
  const incomplete = await omittedCode.read({ image: 'synthetic-omitted-code' });
  assert.equal(incomplete.ok, false);
  assert.equal(incomplete.category, 'INCOMPLETE_TASK');
  assert.match(incomplete.error, /code/i);
  console.log('PASS broader question detection preserves missing-code and incomplete-task safeguards');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
