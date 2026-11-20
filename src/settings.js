const $ = (s) => document.querySelector(s);
const api = window.liveDesk || null;
let cfg = null;

// cached endpoint model lists for the two dropdowns
let llmModelsList = [];
let sttModelsList = [];

init();

async function init() {
  if (!api) { document.body.innerHTML = '<p style="padding:30px;color:#8b93a7">Open this from within the app.</p>'; return; }
  cfg = await api.getConfig();
  fill();
  const displays = await api.screenDisplays();
  for (const display of displays) {
    const option = document.createElement('option');
    option.value = display.id;
    option.textContent = display.label;
    $('#captureMonitor').appendChild(option);
  }
  $('#captureMonitor').value = (cfg.screen && cfg.screen.displayId) || 'primary';

  api.onConfigUpdated((c) => { cfg = c; fill(); });

  $('#save').addEventListener('click', save);
  $('#openPractice').addEventListener('click', () => api.openPractice());
  $('#useOpenAI').addEventListener('click', useOpenAI);
  $('#quit').addEventListener('click', () => api.quitApp());
  $('#testLlm').addEventListener('click', () => test('llm'));
  $('#testStt').addEventListener('click', () => test('stt'));
  $('#refreshModels').addEventListener('click', refreshLlmModels);
  $('#refreshSttModels').addEventListener('click', refreshSttModels);
  $('#llmUrl').addEventListener('change', refreshLlmModels);
  $('#sttUrl').addEventListener('change', refreshSttModels);
  $('#llmModelSel').addEventListener('change', () => syncCustom('llm'));
  $('#sttModelSel').addEventListener('change', () => syncCustom('stt'));
  $('#setupOllama').addEventListener('click', setupOllama);
  $('#installVision').addEventListener('click', installVision);
  $('#screenModelSel').addEventListener('change', () => syncCustom('screen'));
  api.onOllamaProgress((p) => {
    const out = $('#outOllama');
    if (p.stage === 'starting') { out.textContent = 'starting Ollama…'; out.className = 'testOut'; }
    else if (p.stage === 'pulling') {
      out.textContent = 'installing ' + p.model + (p.pct ? ' — ' + p.pct : '…') + ' (one-time download)';
      out.className = 'testOut';
    }
  });
  refreshLlmModels();
  refreshSttModels();
}

async function useOpenAI() {
  const key = $('#openaiKey').value.trim() || $('#llmKey').value.trim();
  const out = $('#outOpenAI');
  if (!key) { out.textContent = 'Enter your OpenAI API key first.'; out.className = 'testOut fail'; return; }
  gather();
  cfg.llm = { ...cfg.llm, baseUrl: 'https://api.openai.com/v1', apiKey: key, model: 'gpt-4.1', temperature: 0.3, maxTokens: 1800 };
  cfg.stt = { ...cfg.stt, baseUrl: 'https://api.openai.com/v1', apiKey: key, model: 'gpt-4o-mini-transcribe' };
  cfg.screen = { ...cfg.screen, model: 'gpt-4.1' };
  cfg.behavior.live = false;
  cfg.behavior.verbosity = 'long';
  cfg.behavior.mode = 'study';
  await api.saveConfig(cfg);
  fill();
  $('#openaiKey').value = '';
  out.textContent = 'Saved. Use Test connection and Test server below.';
  out.className = 'testOut ok';
}

// ------------------------------------------------- model dropdowns

// Renders a <select> from a model list, with a "Custom…" escape hatch that
// reveals a text input for names not on the endpoint.
function fillModelRow(kind, models, current) {
  const sel = $('#' + kind + 'ModelSel');
  const custom = $('#' + kind + 'Model');
  sel.innerHTML = '';
  for (const m of models) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m;
    sel.appendChild(o);
  }
  const customOpt = document.createElement('option');
  customOpt.value = '__custom__';
  customOpt.textContent = 'Custom…';
  sel.appendChild(customOpt);

  if (models.includes(current)) {
    sel.value = current;
    custom.style.display = 'none';
  } else {
    sel.value = '__custom__';
    custom.style.display = '';
    custom.value = current || '';
  }
}

// The model name currently chosen for a row (dropdown or custom text).
function currentModel(kind) {
  const sel = $('#' + kind + 'ModelSel');
  return sel.value === '__custom__' ? $('#' + kind + 'Model').value.trim() : sel.value;
}

function syncCustom(kind) {
  const custom = $('#' + kind + 'Model');
  const isCustom = $('#' + kind + 'ModelSel').value === '__custom__';
  custom.style.display = isCustom ? '' : 'none';
}

async function refreshLlmModels() {
  const btn = $('#refreshModels');
  btn.disabled = true;
  const r = await api.llmModels({ baseUrl: $('#llmUrl').value.trim().replace(/\/+$/, ''), apiKey: $('#llmKey').value.trim() });
  btn.disabled = false;
  if (r.ok && r.models.length) {
    llmModelsList = r.models;
    $('#outOllama').textContent = r.models.length + ' models on this endpoint';
    $('#outOllama').className = 'testOut ok';
  } else {
    $('#outOllama').textContent = '';
  }
  fillModelRow('llm', llmModelsList, currentModel('llm') || (cfg && cfg.llm.model) || '');
  // the vision-model picker draws from the same Ollama list, plus common picks
  const visionList = Array.from(new Set([...(cfg && cfg.screen ? [cfg.screen.model] : []), ...llmModelsList, 'qwen2.5vl:7b', 'moondream']));
  fillModelRow('screen', visionList, currentModel('screen') || (cfg && cfg.screen && cfg.screen.model) || 'qwen2.5vl:7b');
}

// ⤓: start Ollama and install the selected vision model if missing.
async function installVision() {
  gather();
  const btn = $('#installVision');
  btn.disabled = true;
  const out = $('#outOllama');
  const restore = out.textContent;
  out.textContent = 'installing ' + cfg.screen.model + '…';
  out.className = 'testOut';
  const r = await api.ollamaEnsure(cfg.screen.model);
  btn.disabled = false;
  if (r.ok) {
    out.textContent = '✓ vision model ready';
    out.className = 'testOut ok';
    if (r.models) llmModelsList = r.models;
    fillModelRow('screen', Array.from(new Set([...llmModelsList])), cfg.screen.model);
    fillModelRow('llm', llmModelsList, cfg.llm.model);
  } else {
    out.textContent = '✗ ' + r.error;
    out.className = 'testOut fail';
    if (restore) { out.textContent = restore; }
  }
}

async function refreshSttModels() {
  const btn = $('#refreshSttModels');
  btn.disabled = true;
  const r = await api.llmModels({ baseUrl: $('#sttUrl').value.trim().replace(/\/+$/, ''), apiKey: $('#sttKey').value.trim() });
  btn.disabled = false;
  if (r.ok && r.models.length) sttModelsList = r.models;
  fillModelRow('stt', sttModelsList, currentModel('stt') || (cfg && cfg.stt.model) || '');
}

// One click to bring local AI up: starts the Ollama server, installs the
// selected model if it's missing, then refreshes the list.
async function setupOllama() {
  gather();
  const out = $('#outOllama');
  out.textContent = 'working…';
  out.className = 'testOut';
  const r = await api.ollamaEnsure(cfg.llm.model);
  if (r.ok) {
    out.textContent = '✓ local AI ready · ' + (r.models ? r.models.length + ' models' : '');
    out.className = 'testOut ok';
    llmModelsList = r.models || llmModelsList;
    fillModelRow('llm', llmModelsList, cfg.llm.model);
  } else {
    out.textContent = '✗ ' + r.error;
    out.className = 'testOut fail';
  }
}

// ------------------------------------------------- form

function fill() {
  $('#captureMonitor').value = (cfg.screen && cfg.screen.displayId) || 'primary';
  $('#llmUrl').value = cfg.llm.baseUrl || '';
  $('#llmKey').value = cfg.llm.apiKey || '';
  $('#llmTemp').value = cfg.llm.temperature ?? 0.6;
  $('#llmMax').value = cfg.llm.maxTokens ?? 350;
  $('#sttUrl').value = cfg.stt.baseUrl || '';
  $('#sttKey').value = cfg.stt.apiKey || '';
  $('#sttLang').value = cfg.stt.language || '';
  $('#mode').value = cfg.behavior.mode || 'meeting';
  $('#verbosity').value = cfg.behavior.verbosity || 'short';
  $('#autoAnswer').checked = !!cfg.behavior.autoAnswer;
  $('#live').checked = cfg.behavior.live !== false;
  $('#sensitivity').value = cfg.behavior.sensitivity ?? 0.5;
  $('#context').value = cfg.behavior.context || '';
  $('#stealth').checked = !!cfg.overlay.stealth;
  $('#opacity').value = cfg.overlay.opacity ?? 1;
  $('#screenAutoAnswer').checked = !!(cfg.screen && cfg.screen.autoAnswer);
  $('#screenInterval').value = (cfg.screen && cfg.screen.intervalSec) || 8;
  fillModelRow('llm', llmModelsList, cfg.llm.model || '');
  fillModelRow('stt', sttModelsList, cfg.stt.model || '');
  const visionList = Array.from(new Set([...(cfg.screen ? [cfg.screen.model] : []), ...llmModelsList]));
  fillModelRow('screen', visionList, (cfg.screen && cfg.screen.model) || 'qwen2.5vl:7b');
}

function gather() {
  cfg.llm.baseUrl = $('#llmUrl').value.trim().replace(/\/+$/, '');
  cfg.llm.model = currentModel('llm');
  cfg.llm.apiKey = $('#llmKey').value.trim();
  cfg.llm.temperature = parseFloat($('#llmTemp').value);
  cfg.llm.maxTokens = parseInt($('#llmMax').value, 10) || 350;
  cfg.stt.baseUrl = $('#sttUrl').value.trim().replace(/\/+$/, '');
  cfg.stt.model = currentModel('stt');
  cfg.stt.apiKey = $('#sttKey').value.trim();
  cfg.stt.language = $('#sttLang').value;
  cfg.behavior.mode = $('#mode').value;
  cfg.behavior.verbosity = $('#verbosity').value;
  cfg.behavior.autoAnswer = $('#autoAnswer').checked;
  cfg.behavior.live = $('#live').checked;
  cfg.behavior.sensitivity = parseFloat($('#sensitivity').value);
  cfg.behavior.context = $('#context').value;
  cfg.overlay.stealth = $('#stealth').checked;
  cfg.overlay.opacity = parseFloat($('#opacity').value);
  cfg.screen = cfg.screen || {};
  cfg.screen.displayId = $('#captureMonitor').value || 'primary';
  cfg.screen.autoAnswer = $('#screenAutoAnswer').checked;
  cfg.screen.intervalSec = parseInt($('#screenInterval').value, 10) || 8;
  cfg.screen.model = currentModel('screen');
  return cfg;
}

function save() {
  api.saveConfig(gather());
  const f = $('#savedFlash');
  f.classList.add('show');
  setTimeout(() => f.classList.remove('show'), 1600);
}

async function test(which) {
  gather();
  const out = $(which === 'llm' ? '#outLlm' : '#outStt');
  out.textContent = '…testing';
  out.className = 'testOut';
  const t0 = performance.now();
  const req = which === 'llm'
    ? { baseUrl: cfg.llm.baseUrl, apiKey: cfg.llm.apiKey, model: cfg.llm.model }
    : { baseUrl: cfg.stt.baseUrl, apiKey: cfg.stt.apiKey, model: cfg.stt.model, language: cfg.stt.language };
  const r = which === 'llm' ? await api.testLlm(req) : await api.testStt(req);
  const ms = Math.round(performance.now() - t0);
  if (r.ok) {
    out.textContent = '✓ ok (' + ms + ' ms)';
    out.className = 'testOut ok';
  } else {
    out.textContent = '✗ ' + r.error;
    out.className = 'testOut fail';
  }
}
