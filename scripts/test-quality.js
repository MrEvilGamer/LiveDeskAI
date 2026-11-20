const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const main = fs.readFileSync('main.js', 'utf8');
const ctx = vm.createContext({TextDecoder});
vm.runInContext(main.slice(main.indexOf('async function readCompletionStream('), main.indexOf("ipcMain.handle('llm:chat'")), ctx);
async function stream(parts, ollama = false) {
  const events = [];
  const body = new ReadableStream({start(controller) { for (const p of parts) controller.enqueue(new TextEncoder().encode(p)); controller.close(); }});
  await ctx.readCompletionStream(body, ollama, (type, data) => events.push({type, ...data}));
  return events;
}
(async () => {
  let events = await stream(['data: {"choices":[{"delta":{"content":"Hel', 'lo"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}']);
  assert.deepEqual(events.map(e => e.type), ['delta', 'done']);
  assert.equal(events[0].text, 'Hello');
  events = await stream(['data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n']);
  assert.deepEqual(events.map(e => e.type), ['delta', 'error']);
  assert.match(events[1].message, /incomplete/);
  events = await stream(['{"message":{"content":"answer"},"done":false}\n{"done":true,"done_reason":"stop"}'], true);
  assert.deepEqual(events.map(e => e.type), ['delta', 'done']);
  events = await stream(['{"error":"Model unavailable"}'], true);
  assert.equal(events[0].message, 'Model unavailable');
  events = await stream(['data: {"choices":[{"delta":{"content":"cut off"}}]}\n']);
  assert.equal(events.at(-1).type, 'error');
  console.log('PASS real stream parser: split chunks, terminal EOF, stop reasons, truncation, model errors, disconnection');
  vm.runInContext(fs.readFileSync('src/renderer/humanize.js', 'utf8'), ctx);
  const hidden = '<think>private reasoning\n```python\nsecret = 1\n```\n</think>The answer is 42.\n```python\nprint(42)\n```';
  ctx.hidden = hidden;
  assert.equal(vm.runInContext('segmentAnswer(hidden).some(s => /secret|private/.test(s.text))', ctx), false);
  assert.equal(vm.runInContext(`segmentAnswer('<think>private '+String.fromCharCode(96,96,96)+'python\\nsecret=1').length`, ctx), 0);
  assert.equal(vm.runInContext('segmentAnswer(hidden).find(s => s.type === "code").text', ctx), 'print(42)');
  console.log('PASS hidden reasoning never leaks into code; actual code is preserved');
})().catch(e => {console.error(e); process.exitCode = 1;});
