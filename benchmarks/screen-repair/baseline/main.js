const { app, BrowserWindow, globalShortcut, ipcMain, session, desktopCapturer, nativeImage, screen: electronScreen, shell } = require('electron');
const { spawn: spawnProc } = require('child_process');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SMOKE = process.argv.includes('--smoke');

let overlay = null;
let settingsWin = null;
let practiceWin = null;
let quitting = false;
let cfg = null;
let seq = 0;
const inflight = new Map();

const DEFAULTS = {
  llm: { baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'qwen3:4b-instruct-2507-q4_K_M', temperature: 0.6, maxTokens: 1800 },
  stt: { baseUrl: 'http://127.0.0.1:8399/v1', apiKey: '', model: 'base', language: '' },
  behavior: { mode: 'meeting', autoAnswer: true, live: true, verbosity: 'short', context: '', sensitivity: 0.5 },
  screen: { enabled: false, intervalSec: 8, model: 'qwen3-vl:2b', autoAnswer: false },
  overlay: { stealth: true, opacity: 1 },
  hotkeys: { toggle: 'Alt+Space', answer: 'Alt+Shift+A', collapse: 'Alt+Shift+C', currentScreen: 'Alt+Shift+S' }
};

// ---------------------------------------------------------------- config

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Carry over the old Python MVP's settings.json (Ollama model, keys, etc.)
function migrateLegacy(c) {
  try {
    const legacy = JSON.parse(fs.readFileSync(path.join(HERE, 'settings.json'), 'utf8'));
    if (legacy.chat_model) c.llm.model = legacy.chat_model;
    if (legacy.base_url) c.llm.baseUrl = legacy.base_url.replace(/\/$/, '') + (legacy.provider === 'Ollama' ? '/v1' : '');
    if (legacy.api_key) c.llm.apiKey = legacy.api_key;
    if (legacy.transcription_model) c.stt.model = legacy.transcription_model;
    if (typeof legacy.auto_draft === 'boolean') c.behavior.autoAnswer = legacy.auto_draft;
  } catch (_) { /* no legacy config */ }
  return c;
}

function loadConfig() {
  let c = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    c = deepMerge(c, JSON.parse(fs.readFileSync(configFile(), 'utf8')));
  } catch (_) {
    c = migrateLegacy(c);
  }
  cfg = c;
  return c;
}

function saveConfig(c) {
  cfg = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), c);
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));
  } catch (e) { console.error('config write failed:', e); }
  applyConfig();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('config-updated', cfg);
  }
}

function applyConfig() {
  if (overlay && !overlay.isDestroyed()) {
    overlay.setOpacity(Math.max(0.3, Math.min(1, cfg.overlay.opacity ?? 1)));
    overlay.setContentProtection(!!cfg.overlay.stealth);
  }
  registerHotkeys();
}

// ---------------------------------------------------------------- windows

function createOverlay() {
  overlay = new BrowserWindow({
    width: 440,
    height: 640,
    minWidth: 300,
    minHeight: 60,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    type: 'toolbar',        // WS_EX_TOOLWINDOW: hidden from Alt-Tab on Windows
    skipTaskbar: true,
    show: !SMOKE,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(HERE, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setContentProtection(true); // WDA_EXCLUDEFROMCAPTURE: invisible to screen share / recording
  overlay.loadFile(path.join(HERE, 'src', 'overlay.html'), SMOKE ? { search: 'demo=1' } : undefined);
  overlay.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      overlay.hide();
    }
  });
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 600,
    height: 780,
    title: 'LiveDesk AI — Settings',
    backgroundColor: '#0d0f16',
    autoHideMenuBar: true,
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      preload: path.join(HERE, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.loadFile(path.join(HERE, 'src', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

function openPractice() {
  if (practiceWin && !practiceWin.isDestroyed()) { practiceWin.show(); practiceWin.focus(); return; }
  practiceWin = new BrowserWindow({ width: 1050, height: 850, minWidth: 720, minHeight: 600, title: 'LiveDesk AI — Technical practice', backgroundColor: '#10141e', autoHideMenuBar: true, webPreferences: { preload: path.join(HERE, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  practiceWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  practiceWin.webContents.on('will-navigate', (event, url) => { event.preventDefault(); if (/^https:\/\//i.test(url)) shell.openExternal(url); });
  practiceWin.loadFile(path.join(HERE, 'src', 'practice.html'));
  practiceWin.on('closed', () => { practiceWin = null; });
}
ipcMain.handle('practice:open', () => openPractice());

// ---------------------------------------------------------------- session (audio capture)

function setupSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'display-capture', 'audioCapture', 'fullscreen', 'pointerLock'].includes(permission));
  });
  // Auto-approve screen capture and hand Chromium the loopback system-audio device (Windows).
  // Handler signature differs across Electron versions ((request, callback) vs
  // (request, options, callback)) — normalize so callback is always found.
  ses.setDisplayMediaRequestHandler((request, ...rest) => {
    const callback = rest.find((r) => typeof r === 'function');
    const done = (result) => {
      try {
        if (typeof callback === 'function') callback(result);
      } catch (e) {
        console.error('display-media callback failed:', e);
      }
    };
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources.length) done({ video: sources[0], audio: 'loopback' });
      else done({});
    }).catch((e) => {
      console.error('desktopCapturer failed:', e);
      done({});
    });
  });
}

// ---------------------------------------------------------------- hotkeys

function toggleOverlay() {
  if (!overlay || overlay.isDestroyed()) return;
  if (overlay.isVisible()) overlay.hide();
  else { overlay.show(); overlay.focus(); }
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const h = (cfg && cfg.hotkeys) || {};
  const reg = (accel, fn) => { if (accel) { try { globalShortcut.register(accel, fn); } catch (_) {} } };
  reg(h.toggle, toggleOverlay);
  reg(h.answer, () => overlay && overlay.webContents.send('answer-now'));
  reg(h.currentScreen, () => overlay && overlay.webContents.send('current-screen'));
  reg(h.collapse, () => overlay && overlay.webContents.send('toggle-collapse'));
}

// ---------------------------------------------------------------- IPC

// Translate raw undici/socket failures into something a user can act on.
function friendlyNetworkError(err, baseUrl) {
  const code = err && err.cause && err.cause.code;
  let msg = String((err && err.message) || err);
  if (code === 'ECONNREFUSED') {
    msg = 'nothing is listening at ' + baseUrl + ' — start the server (Ollama: run "ollama serve") or fix the Base URL in Settings';
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    msg = 'cannot resolve the host in ' + baseUrl + ' — check the Base URL / your internet';
  } else if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') {
    msg = 'connection dropped by ' + baseUrl;
  } else if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    msg = 'TLS certificate problem with ' + baseUrl;
  } else if (code === 'ETIMEDOUT' || code === 'EACCES') {
    msg = 'network problem reaching ' + baseUrl;
  }
  return msg;
}

ipcMain.handle('config:get', () => cfg);
ipcMain.handle('config:save', (_e, c) => { saveConfig(c); return true; });
ipcMain.handle('settings:open', () => openSettings());
let expandedBounds = null;
ipcMain.handle('overlay:collapse', (_e, collapsed) => {
  if (!overlay || overlay.isDestroyed()) return;
  const b = overlay.getBounds();
  if (collapsed) {
    expandedBounds = b;                       // remember the size the user chose
    overlay.setMinimumSize(200, 44);
    overlay.setBounds({ x: b.x, y: b.y, width: 260, height: 64 });
  } else {
    const r = expandedBounds || { width: 440, height: 640 };
    overlay.setMinimumSize(300, 60);
    overlay.setBounds({ x: b.x, y: b.y, width: r.width, height: r.height });
  }
});
ipcMain.handle('overlay:stealth', (_e, v) => {
  cfg.overlay.stealth = !!v;
  saveConfig(cfg);
  return true;
});
ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });

// --- LLM (routed through main so renderer never hits CORS)

// Ollama endpoints get the native API so we can force think:false — Qwen3-family
// models otherwise burn the token budget on hidden reasoning before answering.
function isOllamaEndpoint(baseUrl) {
  return /:11434/.test(baseUrl || '');
}

function ollamaChatUrl(baseUrl) {
  return baseUrl.replace(/\/$/, '').replace(/\/v1\/?$/, '') + '/api/chat';
}

function completionPayload(baseUrl, payload) {
  if (!/^https:\/\/api\.openai\.com\//i.test(baseUrl)) return payload;
  const out = { ...payload, store: false };
  if (out.max_tokens !== undefined) { out.max_completion_tokens = out.max_tokens; delete out.max_tokens; }
  if (/^(gpt-[56]|o[134])/.test(out.model || '')) delete out.temperature;
  return out;
}

function ollamaMessages(messages) {
  return messages.map((m) => {
    if (!Array.isArray(m.content)) return m;
    return { ...m, content: m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n'),
      images: m.content.filter((p) => p.type === 'image_url').map((p) => p.image_url.url.replace(/^data:image\/\w+;base64,/, '')) };
  });
}

const ollamaVisionCache = new Map();
async function ollamaInputMessages(messages, baseUrl, model) {
  const converted = ollamaMessages(messages);
  if (!converted.some(message => message.images && message.images.length)) return converted;
  const key = baseUrl + '/' + model;
  let entry = ollamaVisionCache.get(key);
  if (!entry || Date.now() - entry.at > 60000) {
    try {
      const url = ollamaChatUrl(baseUrl).replace(/\/chat$/, '/show');
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model }), signal: AbortSignal.timeout(2000) });
      if (!response.ok) throw new Error('Model capabilities unavailable');
      const info = await response.json();
      entry = { at: Date.now(), vision: (info.capabilities || []).includes('vision') };
      ollamaVisionCache.set(key, entry);
    } catch (_) { entry = { vision: false }; }
  }
  return entry.vision ? converted : converted.map(({ images, ...message }) => message);
}

// Consume both supported streaming protocols, including an EOF without a newline.
async function readCompletionStream(body, ollama, send) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', terminal = false;
  const line = raw => {
    if (terminal) return;
    let data = raw.trim();
    if (!data) return;
    if (!ollama) {
      if (!data.startsWith('data:')) return;
      data = data.slice(5).trim();
      if (data === '[DONE]') { terminal = true; send('done', {}); return; }
    }
    let item;
    try { item = JSON.parse(data); } catch (_) { return; }
    if (item.error) {
      terminal = true;
      send('error', { message: typeof item.error === 'string' ? item.error : item.error.message || 'Model stream failed' });
      return;
    }
    const choice = item.choices && item.choices[0];
    const text = ollama ? item.message && item.message.content : choice && choice.delta && choice.delta.content;
    if (text) send('delta', { text });
    const reason = ollama ? item.done_reason : choice && choice.finish_reason;
    if (ollama ? item.done : reason) {
      terminal = true;
      if (reason === 'length') send('error', { message: 'Answer reached the token limit and is incomplete. Increase Max tokens in Settings and press Redo.' });
      else if (reason === 'content_filter') send('error', { message: 'The provider filtered this answer. Rephrase the question and try again.' });
      else send('done', {});
    }
  };
  try {
    while (!terminal) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (done) { line(buffer); break; }
    }
    if (!terminal) send('error', { message: 'AI connection closed before the answer finished' });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

ipcMain.handle('llm:chat', (e, req) => {
  const id = ++seq;
  const ac = new AbortController();
  inflight.set(id, ac);
  const send = (type, extra) => {
    if (!e.sender.isDestroyed()) e.sender.send('llm:event', { id, type, ...extra });
  };
  (async () => {
    try {
      const ollama = isOllamaEndpoint(req.baseUrl);
      const url = ollama
        ? ollamaChatUrl(req.baseUrl)
        : req.baseUrl.replace(/\/$/, '') + '/chat/completions';
      const headers = { 'Content-Type': 'application/json' };
      if (req.apiKey) headers.Authorization = 'Bearer ' + req.apiKey;
      let body;
      if (ollama) {
        body = JSON.stringify({
          model: req.payload.model,
          messages: await ollamaInputMessages(req.payload.messages, req.baseUrl, req.payload.model),
          stream: req.payload.stream !== false,
          think: false,
          options: {
            temperature: req.payload.temperature,
            num_ctx: 8192,
            num_predict: req.payload.max_tokens
          }
        });
      } else {
        body = JSON.stringify(completionPayload(req.baseUrl, req.payload));
      }
      let res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.any([ac.signal, AbortSignal.timeout(90000)])
      });
      if (!res.ok && ollama && JSON.parse(body).messages.some(message => message.images && message.images.length)) {
        const imageError = await res.text().catch(() => '');
        if (/image input is not supported|mmproj|does not support images/i.test(imageError)) {
          const retryBody = JSON.parse(body);
          retryBody.messages = retryBody.messages.map(({ images, ...message }) => message);
          ollamaVisionCache.set(req.baseUrl + '/' + req.payload.model, { at: Date.now(), vision: false });
          res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(retryBody), signal: AbortSignal.any([ac.signal, AbortSignal.timeout(90000)]) });
        } else {
          send('error', { message: 'HTTP ' + res.status + ' ' + imageError.slice(0, 300) });
          return;
        }
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        send('error', { message: 'HTTP ' + res.status + ' ' + t.slice(0, 300) });
        return;
      }
      const ctype = res.headers.get('content-type') || '';
      if (req.payload.stream !== false && (ollama || ctype.includes('event-stream'))) {
        await readCompletionStream(res.body, ollama, send);
      } else {
        const j = await res.json();
        const choice = j.choices && j.choices[0];
        const txt = ollama ? (j.message && j.message.content) || '' : (choice && choice.message && choice.message.content) || '';
        send('delta', { text: txt });
        if ((ollama ? j.done_reason : choice && choice.finish_reason) === 'length') {
          send('error', { message: 'Answer reached the token limit and is incomplete. Increase Max tokens in Settings and press Redo.' });
        } else send('done', {});
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        send('aborted', {});
      } else {
        send('error', { message: friendlyNetworkError(err, req.baseUrl) });
      }
    } finally {
      inflight.delete(id);
    }
  })();
  return { id };
});

ipcMain.handle('llm:abort', (_e, id) => {
  const ac = inflight.get(id);
  if (ac) ac.abort();
});

// --- local AI (Ollama) auto-management:
// start the server if it's down, pull the configured model if it's missing.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ollamaBin() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'),
    'C:\\Program Files\\Ollama\\ollama.exe',
    'ollama' // PATH
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === 'ollama') return c; // resolvable via PATH; spawn will fail loudly if not
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  return null;
}

async function ollamaUp() {
  try {
    const r = await fetch('http://127.0.0.1:11434/', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch (_) {
    return false;
  }
}

// Brings Ollama + the wanted model up. Emits 'ollama:progress' to the sender.
async function ensureOllama(sender, model) {
  const progress = (p) => { try { sender.send('ollama:progress', p); } catch (_) {} };
  const bin = ollamaBin();
  if (!bin) return { ok: false, error: 'Ollama is not installed — get it from https://ollama.com', code: 'no-ollama' };

  if (!(await ollamaUp())) {
    progress({ stage: 'starting' });
    try {
      spawnProc(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch (e) {
      return { ok: false, error: 'could not launch ollama serve: ' + e.message };
    }
    let up = false;
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      if (await ollamaUp()) { up = true; break; }
    }
    if (!up) return { ok: false, error: 'Ollama server did not come up within 25 s' };
  }

  let models = [];
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) });
    models = ((await r.json()).models || []).map((m) => m.name);
  } catch (_) {}

  const wanted = (model || '').trim();
  const have = models.some((m) => m === wanted || m.split(':')[0] === wanted.split(':')[0]);
  if (wanted && !have) {
    progress({ stage: 'pulling', model: wanted });
    const pulled = await new Promise((resolve) => {
      const p = spawnProc(bin, ['pull', wanted], { windowsHide: true });
      let buf = '';
      p.stdout.on('data', (d) => {
        buf = (buf + d.toString()).slice(-4000);
        const pcts = buf.match(/\d+(?:\.\d+)?%/g);
        if (pcts) progress({ stage: 'pulling', model: wanted, pct: pcts[pcts.length - 1] });
      });
      p.on('close', (code) => resolve(code === 0));
      p.on('error', () => resolve(false));
    });
    if (!pulled) return { ok: false, error: 'failed to pull model ' + wanted, models };
    try {
      const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) });
      models = ((await r.json()).models || []).map((m) => m.name);
    } catch (_) {}
  }
  return { ok: true, models };
}

ipcMain.handle('ollama:ensure', (e, { model }) => ensureOllama(e.sender, model));

// Cheap liveness check: ANY http response (even 404/401) means the server is
// up — no tokens burned, no inference triggered.
ipcMain.handle('net:ping', async (_e, req) => {
  try {
    await fetch(req.url, { signal: AbortSignal.timeout(4000) });
    return { ok: true };
  } catch (_) {
    return { ok: false };
  }
});

// --- screen understanding: capture + vision read

ipcMain.handle('screen:displays', () => electronScreen.getAllDisplays().map((d, i) => ({
  id: String(d.id), label: 'Monitor ' + (i + 1) + ' — ' + d.size.width + '×' + d.size.height + (d.id === electronScreen.getPrimaryDisplay().id ? ' (primary)' : ''), bounds: d.bounds
})));

async function captureScreenFrame(options = {}) {
  const hidden = [];
  try {
    if (options && options.unobstructed) {
      for (const win of [overlay, settingsWin]) {
        if (win && !win.isDestroyed() && win.isVisible()) { hidden.push(win); win.hide(); }
      }
      if (hidden.length) await new Promise(resolve => setTimeout(resolve, 150));
    }
    const displays = electronScreen.getAllDisplays();
    const selectedId = cfg.screen && cfg.screen.displayId;
    const display = selectedId && selectedId !== 'primary'
      ? displays.find((d) => String(d.id) === selectedId) : electronScreen.getPrimaryDisplay();
    if (!display) return { ok: false, error: 'The selected monitor is disconnected. Select a monitor in Settings.' };
    // Retain enough detail for small editor text without unbounded image tokens.
    const capW = Math.min(display.size.width, 1920);
    const capH = Math.round(display.size.height * (capW / display.size.width));
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: capW, height: capH }
    });
    if (!sources.length) return { ok: false, error: 'no screen to capture' };
    // The overlay is content-protected, so it never appears in this image.
    const source = sources.find((s) => s.display_id === String(display.id));
    if (!source) return { ok: false, error: 'Could not identify the selected monitor in the capture sources.' };
    // Mask our panels in the model input even when screen-share protection is off.
    // Otherwise vision reads its own previous answer and generates a feedback loop.
    let captured = source.thumbnail;
    const size = captured.getSize();
    const bitmap = captured.toBitmap();
    const sx = size.width / display.size.width, sy = size.height / display.size.height;
    for (const win of [overlay, settingsWin]) {
      if (!win || win.isDestroyed() || !win.isVisible()) continue;
      const bounds = win.getBounds();
      const left = Math.max(0, Math.floor((bounds.x - display.bounds.x - 8) * sx));
      const top = Math.max(0, Math.floor((bounds.y - display.bounds.y - 8) * sy));
      const right = Math.min(size.width, Math.ceil((bounds.x + bounds.width - display.bounds.x + 8) * sx));
      const bottom = Math.min(size.height, Math.ceil((bounds.y + bounds.height - display.bounds.y + 8) * sy));
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const i = (y * size.width + x) * 4;
        bitmap[i] = bitmap[i + 1] = bitmap[i + 2] = 0;
        bitmap[i + 3] = 255;
      }
    }
    captured = nativeImage.createFromBitmap(bitmap, size);
    const pixels = captured.resize({ width: 160, height: 90 }).toBitmap();
    const fingerprint = [];
    for (let i = 0; i < pixels.length; i += 4) fingerprint.push(Math.round((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3));
    return { ok: true, image: captured.toDataURL(), fingerprint, displayId: String(display.id), displayLabel: display.size.width + '×' + display.size.height };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  } finally {
    for (const win of hidden) if (!win.isDestroyed()) win.showInactive();
  }
}
let captureQueue = Promise.resolve();
ipcMain.handle('screen:capture', (_event, options) => {
  const next = captureQueue.then(() => captureScreenFrame(options));
  captureQueue = next.catch(() => {});
  return next;
});

let visionController = null;
let ocrSequence = 0;
function questionFromOcr(lines) {
  const visible = (lines || []).filter((line) => line.text && line.text.trim());
  for (let i = visible.length - 1; i >= 0; i--) {
    const text = visible[i].text.trim();
    if (/^(troubleshoot(ing)?|snipping tool|captured screen|current screen|read again|settings updated)[.!]?$/i.test(text)) continue;
    if (/please note|before starting|interview (will take|is monitored)|recording.*saved|remain on the same tab/i.test(text)) continue;
    if (!(/\?/.test(text) || /^(how|what|why|when|where|who|which|could you|can you|please|introduce|explain|describe|write|implement|solve|calculate|tell me|walk me|give me|share|discuss|compare|debug|fix|find|complete|design|analy[sz]e|optimi[sz]e)\b/i.test(text))) continue;
    if (/live.?desk|screen read|current screen|brave search/i.test(text)) continue;
    const block = [text];
    // OCR splits a wrapped interview prompt into separate physical lines.
    for (let j = i - 1; j >= Math.max(0, i - 30); j--) {
      const a = visible[j], b = visible[j + 1];
      if (/[?]/.test(a.text) || /[.!]$/.test(a.text.trim()) || Math.abs(a.x - b.x) > 45 || b.y - a.y < 0 || b.y - a.y > 35) break;
      block.unshift(a.text.trim());
    }
    for (let j = i + 1; !block.join(' ').includes('?') && j < Math.min(visible.length, i + 30); j++) {
      const a = visible[j - 1], b = visible[j];
      if (Math.abs(a.x - b.x) > 45 || b.y - a.y < 0 || b.y - a.y > 35) break;
      block.push(b.text.trim());
    }
    return block.join(' ');
  }
  return '';
}

function taskFromOcr(lines, completeTask = false) {
  const visible = (lines || []).filter(line => line.text && line.text.trim() && !/^(captured screen|current screen|read again|settings updated|live answer|live transcript)$/i.test(line.text.trim()));
  const question = questionFromOcr(visible);
  const hasCode = visible.some(line => /(?:\b(?:def|class|function|return|const|let|var|SELECT|print|console\.log)\b|=>|[{}]|Traceback|Exception|Error:|^[A-D][.)]\s)/.test(line.text));
  if (!question && !hasCode) return '';
  if (!hasCode && !completeTask) return question;
  // OCR line order and indentation retain code from a separate lower/side pane.
  const context = visible.map(line => ' '.repeat(Math.min(40, Math.max(0, Math.round((line.x || 0) / 8)))) + line.text.trim()).join('\n');
  return (question || 'Help solve or explain the visible coding task.') + '\n\nVisible task details and code (OCR may contain character errors):\n' + (context.length > 18000 ? context.slice(0, 6000) + '\n[Middle screen text omitted]\n' + context.slice(-12000) : context);
}

async function readWindowsText(image, signal) {
  const root = app.getPath('userData');
  fs.mkdirSync(root, { recursive: true });
  const script = path.join(root, 'screen-ocr.ps1');
  fs.writeFileSync(script, fs.readFileSync(path.join(HERE, 'scripts', 'screen-ocr.ps1')));
  const file = path.join(root, 'ocr-' + (++ocrSequence) + '.png');
  fs.writeFileSync(file, nativeImage.createFromDataURL(image).toPNG());
  try {
    return await new Promise((resolve, reject) => {
      const child = spawnProc('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ImagePath', file], { windowsHide: true, signal });
      let output = '', errorOutput = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Windows OCR timed out')); }, 6000);
      child.stdout.on('data', (d) => { output += d.toString(); });
      child.stderr.on('data', (d) => { errorOutput += d.toString(); });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) { reject(new Error(errorOutput.slice(0, 500) || 'Windows OCR unavailable')); return; }
        try { resolve(JSON.parse(output.trim().replace(/^\uFEFF/, ''))); } catch (e) { reject(e); }
      });
    });
  } finally { try { fs.unlinkSync(file); } catch (_) {} }
}
ipcMain.handle('vision:cancel', () => { if (visionController) visionController.abort(); });
ipcMain.handle('vision:read', async (_e, req) => {
  const controller = new AbortController();
  visionController = controller;
  let recognizedText = '', ocrTask = '';
  try {
    if (process.platform === 'win32') {
      try {
        const ocr = await readWindowsText(req.image, controller.signal);
        recognizedText = ocr.text || '';
        let question = taskFromOcr(ocr.lines, !!req.completeTask);
        if (!req.completeTask && /below|javascript|snippet|code|review|spot.*issue/i.test(question)) {
          req = { ...req, completeTask: true };
          question = taskFromOcr(ocr.lines, true);
        }
        if (!req.completeTask && question && !question.includes('Visible task details and code')) return { ok: true, text: question, recognizedText: ocr.text, method: 'Windows OCR' };
        ocrTask = question;
      } catch (e) { if (controller.signal.aborted) throw e; console.error('OCR fallback:', e.message); }
    }
    const imageInputs = [req.image];
    if (req.completeTask) {
      const frame = nativeImage.createFromDataURL(req.image);
      const size = frame.getSize();
      if (size.height >= 400 && size.width > 0) {
        const y = Math.floor(size.height * 0.35);
        const lower = frame.crop({ x: 0, y, width: size.width, height: size.height - y }).toDataURL();
        if (ocrTask && /below|javascript|code|snippet|spot|review/i.test(ocrTask)) imageInputs.splice(0, imageInputs.length, lower);
      }
    }
    const extractionPrompt = req.prompt + (req.completeTask ? '\nRead EVERY task-bearing section, not only the first question. For code tasks the image is a focused crop of the lower section of the screen; the OCR hints supply the question and instructions from above. For other tasks the image is the full screen. Consolidate the image and OCR into one task and transcribe each code block only once. Extract the top question, instructions below it, numbered follow-up questions, and the complete JavaScript/editor contents. If asked to spot bugs, include the code to review. Do not stop at the top question. Keep operators and code indentation. Use CODE_UNREADABLE only if no code can be transcribed. Do not append it after code you have transcribed. Do not invent missing lines.' : '') + (ocrTask ? '\nOCR hints follow. Correct character errors using the images and retain all code operators and indentation:\n' + ocrTask.slice(0, 14000) : '');
    const extracted = text => {
      const visible = text.trim();
      const empty = !visible || /^NO_TASK[.!]?$/i.test(visible);
      const combined = empty && ocrTask ? ocrTask : (ocrTask && visible !== ocrTask ? visible + '\n\nSupporting OCR of the SAME screen (may overlap the extraction above; not additional code samples):\n' + ocrTask : visible);
      return { ok: true, text: combined, recognizedText, method: 'Vision + OCR' };
    };
    if (isOllamaEndpoint(req.baseUrl)) {
      const url = ollamaChatUrl(req.baseUrl);
      const images = imageInputs.map(image => String(image).replace(/^data:image\/\w+;base64,/, ''));
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.model,
          stream: false,
          think: false,
          messages: [{ role: 'user', content: extractionPrompt, images }],
          options: { num_predict: req.completeTask ? 1600 : 800, num_ctx: 8192, temperature: 0 }
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(req.completeTask ? 55000 : 35000)])
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        if (ocrTask) return { ok: true, text: ocrTask, recognizedText, method: 'Windows OCR (vision unavailable)' };
        return { ok: false, error: 'HTTP ' + res.status + ' ' + t.slice(0, 200) };
      }
      const j = await res.json();
      const text = (j.message && j.message.content) || '';
      if (/^(no[,.! ]+)*(everything (is |looks )?(fine|okay|ok)|no (issues|problems)|nothing (is )?wrong)/i.test(text.trim())) {
        return { ok: false, error: 'The reader returned a diagnosis instead of extracting visible text. Check Captured screen.', recognizedText };
      }
      if (/return NO_TASK only|ignore LiveDeskAI panels|output only the exact question|never explain what is on screen/i.test(text)) {
        return { ok: false, error: 'The vision model repeated its instructions instead of reading the screen. See Captured screen.' };
      }
      return extracted(text);
    }
    const url = req.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (req.apiKey) headers.Authorization = 'Bearer ' + req.apiKey;
    const res = await fetch(url, {
      method: 'POST',
      headers,
    body: JSON.stringify(completionPayload(req.baseUrl, {
      model: req.model,
      stream: false,
      max_tokens: 1800,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: extractionPrompt },
          ...imageInputs.map(image => ({ type: 'image_url', image_url: { url: image } }))
        ]
      }]
    })),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(req.completeTask ? 55000 : 35000)])
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      if (ocrTask) return { ok: true, text: ocrTask, recognizedText, method: 'Windows OCR (vision unavailable)' };
        return { ok: false, error: 'HTTP ' + res.status + ' ' + t.slice(0, 200) };
    }
    const j = await res.json();
    const text = ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
    return extracted(text);
  } catch (err) {
    if (ocrTask && !controller.signal.aborted) return { ok: true, text: ocrTask, recognizedText, method: 'Windows OCR (vision unavailable)' };
    return { ok: false, error: friendlyNetworkError(err, req.baseUrl) };
  } finally {
    if (visionController === controller) visionController = null;
  }
});

ipcMain.handle('llm:models', async (_e, req) => {
  try {
    const url = req.baseUrl.replace(/\/$/, '') + '/models';
    const headers = {};
    if (req.apiKey) headers.Authorization = 'Bearer ' + req.apiKey;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
    const j = await res.json();
    return { ok: true, models: (j.data || []).map((m) => m.id).filter(Boolean) };
  } catch (err) {
    return { ok: false, error: friendlyNetworkError(err, req.baseUrl) };
  }
});

ipcMain.handle('llm:test', async (_e, req) => {
  try {
    if (isOllamaEndpoint(req.baseUrl)) {
      const res = await fetch(ollamaChatUrl(req.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: req.model, stream: false, think: false, messages: [{ role: 'user', content: 'ping' }], options: { num_predict: 5 } }),
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200) };
      return { ok: true };
    }
    const url = req.baseUrl.replace(/\/$/, '') + '/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (req.apiKey) headers.Authorization = 'Bearer ' + req.apiKey;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(completionPayload(req.baseUrl, { model: req.model, messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 64, stream: false })),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyNetworkError(err, req.baseUrl) };
  }
});

// --- STT proxy

function makeSilenceWav(seconds) {
  const sr = 16000;
  const n = Math.round(sr * seconds);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}

ipcMain.handle('stt:transcribe', async (_e, req) => {
  const url = req.baseUrl.replace(/\/$/, '') + '/audio/transcriptions';
  const form = new FormData();
  form.append('file', new Blob([req.audio], { type: 'audio/wav' }), 'chunk.wav');
  form.append('model', req.model || 'base');
  form.append('response_format', 'json');
  if (req.interim) form.append('interim', '1');          // local server: cheap, droppable decode
  if (req.language) form.append('language', req.language);
  if (req.hotwords && /:8399/.test(req.baseUrl)) form.append('hotwords', req.hotwords);
  const headers = {};
  if (req.apiKey) headers.Authorization = 'Bearer ' + req.apiKey;
  // Never let a hung server wedge the live pipeline.
  const res = await fetch(url, {
    method: 'POST', headers, body: form,
    signal: AbortSignal.timeout(req.interim ? 8000 : 25000)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  return { text: (j && j.text) || '', skipped: !!(j && j.skipped), speechVerified: !!(j && j.speechVerified) };
});

ipcMain.handle('stt:test', async (_e, req) => {
  const url = req.baseUrl.replace(/\/$/, '') + '/audio/transcriptions';
  const form = new FormData();
  form.append('file', new Blob([makeSilenceWav(0.5)], { type: 'audio/wav' }), 'test.wav');
  form.append('model', req.model || 'base');
  form.append('response_format', 'json');
  if (req.language) form.append('language', req.language);
  const headers = {};
  if (req.apiKey) headers.Authorization = 'Bearer ' + req.apiKey;
  try {
    const res = await fetch(url, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { ok: false, error: 'HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200) };
    return { ok: true };
  } catch (err) {
    const error = friendlyNetworkError(err, req.baseUrl);
    return { ok: false, error: error + (req.baseUrl.indexOf('8399') >= 0 ? ' — run start-stt.bat' : '') };
  }
});

// ---------------------------------------------------------------- smoke test (renders UI to PNGs)

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

// capturePage returns an empty image until the window has composited at least
// once — poll until there are real pixels (hidden/occluded windows never do).
async function shot(name, win) {
  for (let i = 0; i < 24; i++) {
    const img = await win.webContents.capturePage().catch(() => null);
    if (img && !img.isEmpty()) {
      fs.writeFileSync(path.join(HERE, name), img.toPNG());
      return;
    }
    await wait(250);
  }
  console.log('smoke: capture stayed empty:', name);
}

async function smoke() {
  for (let i = 0; i < 60; i++) {
    const ready = await overlay.webContents.executeJavaScript('!!window.__demoReady').catch(() => false);
    if (ready) break;
    await wait(200);
  }
  // Hidden windows never tick CSS transitions/animations — show the window so
  // screenshots capture the settled visual state.
  overlay.show();
  await wait(800);
  await shot('smoke-overlay.png', overlay);
  await overlay.webContents.executeJavaScript('window.__setCollapsed(true)');
  await wait(600);
  await shot('smoke-collapsed.png', overlay);
  await overlay.webContents.executeJavaScript('window.__setCollapsed(false)');
  await new Promise((resolve) => {
    openSettings();
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.webContents.once('did-finish-load', resolve);
      setTimeout(resolve, 5000); // safety net
    } else {
      resolve();
    }
  });
  // The always-on-top overlay occludes the settings window, and fully
  // occluded windows never paint — hide the overlay so the capture isn't empty.
  overlay.hide();
  settingsWin.moveTop();
  await wait(700);
  await shot('smoke-settings.png', settingsWin);
  await wait(300);
  app.quit();
}

// ---------------------------------------------------------------- lifecycle

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let sttStartPromise = null;
function startLocalTranscription() {
  if (!sttStartPromise) sttStartPromise = launchLocalTranscription().finally(() => { sttStartPromise = null; });
  return sttStartPromise;
}
ipcMain.handle('stt:ensure', () => startLocalTranscription());
async function launchLocalTranscription() {
  let endpoint;
  try { endpoint = new URL(cfg.stt.baseUrl); } catch (_) { return; }
  if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname) || endpoint.port !== '8399') return;
  try {
    const response = await fetch(endpoint.origin + '/v1/models', { signal: AbortSignal.timeout(2000) });
    if (response.ok) return { ok: true };
  } catch (_) {}
  let installedRoot;
  try { installedRoot = JSON.parse(fs.readFileSync(path.join(HERE, 'assets', 'runtime-root.json'), 'utf8')).root; } catch (_) {}
  const roots = [installedRoot, HERE, process.env.PORTABLE_EXECUTABLE_DIR && path.dirname(process.env.PORTABLE_EXECUTABLE_DIR), path.resolve(path.dirname(process.execPath), '..', '..')].filter(Boolean);
  const root = roots.find((r) => fs.existsSync(path.join(r, 'stt_server.py')) && fs.existsSync(path.join(r, '.venv', 'Scripts', 'pythonw.exe')));
  if (!root) return { ok: false, error: 'Local transcription Python environment was not found.' };
  const out = fs.openSync(path.join(root, 'stt-out.log'), 'a');
  const err = fs.openSync(path.join(root, 'stt-err.log'), 'a');
  try {
    const child = spawnProc(path.join(root, '.venv', 'Scripts', 'pythonw.exe'), ['-u', 'stt_server.py', '--model', cfg.stt.model || 'base', '--port', '8399'], {
      cwd: root, windowsHide: true, detached: true, stdio: ['ignore', out, err], env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });
    child.on('error', (e) => console.error('transcription startup failed:', e.message));
    child.unref();
  } finally { fs.closeSync(out); fs.closeSync(err); }
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(endpoint.origin + '/v1/models', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return { ok: true };
    } catch (_) {}
    await wait(500);
  }
  return { ok: false, error: 'Local transcription did not finish starting. Check stt-err.log.' };
}

app.on('second-instance', () => {
  if (overlay && !overlay.isDestroyed()) { overlay.show(); overlay.focus(); }
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.livedesk.ai');
  loadConfig();
  if (!SMOKE) startLocalTranscription().catch((e) => console.error('transcription startup failed:', e.message));
  setupSession();
  createOverlay();
  applyConfig(); // also registers hotkeys
  if (SMOKE) smoke();
}).catch((e) => console.error('startup failed:', e));

app.on('before-quit', () => { quitting = true; });

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (quitting) app.quit(); // otherwise keep running with the overlay hidden
});
