// Controlled local-only sample. Never reads the desktop, app config, or API keys.
// Usage: node scripts/probe-vision-latency.js --model=frob/qwen3.5-instruct:4b
// Add --endpoint=openai to check Ollama's compatibility endpoint. Models are not installed or removed.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const arg = (name, fallback) => process.argv.find(value => value.startsWith('--' + name + '='))?.split('=').slice(1).join('=') || fallback;
const model = arg('model', 'frob/qwen3.5-instruct:4b');
const endpoint = arg('endpoint', 'native');
if (!['native', 'openai'].includes(endpoint)) throw new Error('endpoint must be native or openai');
const timeoutMs = Math.min(55000, Math.max(1000, Number(arg('timeout-ms', '20000'))));
const maxTokens = Math.min(1600, Math.max(1, Number(arg('max-tokens', '96'))));
const directory = path.join(__dirname, '..', 'benchmarks', 'vision-latency');
fs.mkdirSync(directory, { recursive: true });
const fixture = path.join(directory, 'synthetic-question.png');
if (!fs.existsSync(fixture)) {
  const python = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');
  const fixtureCode = [
    'from PIL import Image, ImageDraw, ImageFont',
    'import sys',
    'image = Image.new("RGB", (1100, 500), "white")',
    'draw = ImageDraw.Draw(image)',
    'font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 48)',
    'draw.text((55, 100), "What is dynamic programming?", font=font, fill="black")',
    'draw.text((55, 185), "Give a short C++ example.", font=font, fill="black")',
    'image.save(sys.argv[1])'
  ].join('\n');
  const created = spawnSync(python, ['-c', fixtureCode, fixture], { timeout: 15000, encoding: 'utf8', windowsHide: true });
  if (created.status !== 0) throw new Error('Could not create synthetic fixture: ' + (created.stderr || created.error?.message));
}
const encodedImage = fs.readFileSync(fixture).toString('base64');
const prompt = 'Transcribe the question and instruction visible in this image, exactly. Output only the visible text. Do not answer the question.';
const expectedText = 'What is dynamic programming? Give a short C++ example.';
const safeName = model.replace(/[^a-zA-Z0-9.-]+/g, '_');
const outputFile = path.resolve(arg('output', path.join(directory, safeName + '-' + endpoint + '.json')));
const result = {
  createdAt: new Date().toISOString(), model, endpoint, origin: 'http://127.0.0.1:11434',
  sampleOnly: true, realScreenCaptured: false, fixture: path.basename(fixture),
  prompt, expectedText, parameters: { think: false, num_ctx: 8192, num_predict: maxTokens, temperature: 0, timeoutMs },
  note: 'One controlled synthetic sample, not a benchmark. Streamed to measure first content token; application native vision uses nonstreaming responses.'
};
const now = () => performance.now();
const ms = value => Math.round(value * 10) / 10;
async function checkedFetch(url, body, timeout) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + (await response.text()).slice(0, 500));
  return response;
}
async function main() {
  let stage = 'model-loading';
  let started = now();
  try {
    // Empty messages load the model without including image encoding or prompt evaluation.
    const loadResponse = await checkedFetch(result.origin + '/api/chat', { model, messages: [], stream: false, keep_alive: '10m', options: { num_ctx: 8192 } }, 55000);
    const loaded = await loadResponse.json();
    result.loading = { ok: true, totalMs: ms(now() - started), ollamaLoadMs: loaded.load_duration == null ? null : ms(loaded.load_duration / 1e6) };
    console.log(JSON.stringify({ stage, model, ...result.loading }));
    stage = 'image-inference';
    started = now();
    const native = endpoint === 'native';
    const body = native
      ? { model, stream: true, think: false, keep_alive: '10m', messages: [{ role: 'user', content: prompt, images: [encodedImage] }], options: { num_ctx: 8192, num_predict: maxTokens, temperature: 0 } }
      : { model, stream: true, think: false, temperature: 0, max_tokens: maxTokens, options: { num_ctx: 8192, num_predict: maxTokens }, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + encodedImage } }] }], stream_options: { include_usage: true } };
    const response = await checkedFetch(result.origin + (native ? '/api/chat' : '/v1/chat/completions'), body, timeoutMs);
    result.inference = { ok: false, headersMs: ms(now() - started), firstTokenMs: null, firstContentTokenMs: null, output: '', thinkingCharacters: 0 };
    let buffer = '';
    let done = false;
    const decoder = new TextDecoder();
    const consume = line => {
      line = line.trim();
      if (!line || (!native && !line.startsWith('data:'))) return;
      const payload = native ? line : line.slice(5).trim();
      if (payload === '[DONE]') { done = true; return; }
      const event = JSON.parse(payload);
      if (event.error) throw new Error(typeof event.error === 'string' ? event.error : JSON.stringify(event.error));
      const delta = native ? event.message || {} : event.choices?.[0]?.delta || {};
      const thinking = delta.thinking || delta.reasoning || delta.reasoning_content || '';
      const content = delta.content || '';
      if ((content || thinking) && result.inference.firstTokenMs == null) result.inference.firstTokenMs = ms(now() - started);
      if (content && result.inference.firstContentTokenMs == null) result.inference.firstContentTokenMs = ms(now() - started);
      result.inference.output += content;
      result.inference.thinkingCharacters += thinking.length;
      if (event.done) { done = true; result.inference.metrics = Object.fromEntries(['total_duration', 'load_duration', 'prompt_eval_count', 'prompt_eval_duration', 'eval_count', 'eval_duration', 'done_reason'].filter(key => event[key] != null).map(key => [key, event[key]])); }
      if (event.usage) result.inference.usage = event.usage;
    };
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) { consume(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    result.inference.totalMs = ms(now() - started);
    result.inference.ok = done && !!result.inference.output.trim();
    result.inference.exactText = result.inference.output.replace(/\s+/g, ' ').trim() === expectedText;
    console.log(JSON.stringify({ stage, model, ...result.inference }));
  } catch (error) {
    const failure = { ok: false, stage, totalMs: ms(now() - started), errorName: error.name, error: error.message };
    if (stage === 'model-loading') result.loading = failure;
    else result.inference = { ...result.inference, ...failure };
    console.log(JSON.stringify({ model, ...failure }));
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n');
    console.log('Saved ' + outputFile);
  }
}
main();
