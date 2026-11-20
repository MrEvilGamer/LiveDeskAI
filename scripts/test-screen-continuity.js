const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const main = fs.readFileSync('main.js', 'utf8');
const overlay = fs.readFileSync('src/overlay.js', 'utf8');
const ctx = vm.createContext({});
vm.runInContext(main.slice(main.indexOf('function questionFromOcr('), main.indexOf('async function readWindowsText')), ctx);
vm.runInContext(overlay.slice(overlay.indexOf('function continuedScreenText('), overlay.indexOf('let currentScreenRequest')), ctx);
ctx.lines = [
  'You are not allowed to use any external code editors during the session.',
  'You can take the interview later by clicking the end call button now.',
  'Are you ready to begin?',
  'To tailor this interview to your expertise, I will ask a few quick questions.',
  "What’s your primary coding language, or the language required by the",
  'application?'
].map((text, i) => ({text, x: 40, y: 100 + i * 28}));
assert.equal(vm.runInContext('questionFromOcr(lines)', ctx), "What’s your primary coding language, or the language required by the application?");
assert.equal(vm.runInContext(`continuedScreenText('Explain how a queue works when the buffer is full', 'when the buffer is full and a producer writes again.')`, ctx), 'Explain how a queue works when the buffer is full and a producer writes again.');
assert.equal(vm.runInContext(`continuedScreenText('What is a queue?', 'What is a stack?')`, ctx), 'What is a stack?');
assert.equal(vm.runInContext(`continuedScreenText('Explain how a queue works', 'Explain how a queue works')`, ctx), 'Explain how a queue works');
console.log('PASS latest wrapped question, scrolling overlap, repeated captures, unrelated questions');
