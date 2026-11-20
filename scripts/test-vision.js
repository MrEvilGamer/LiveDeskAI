// End-to-end screen reading test: captures the real display through the app's
// IPC and sends it to the vision model through vision:read (same path as the 👁 loop).
// Runs in its own userData dir so it can run next to the packaged app.
const { app, BrowserWindow, ipcMain, desktopCapturer, screen: electronScreen } = require('electron');
const path = require('path');

app.setPath('userData', path.join(require('os').tmpdir(), 'livedesk-test'));

// copies of the handlers from main.js
ipcMain.handle('screen:capture', async () => {
  const display = electronScreen.getPrimaryDisplay();
  const capW = Math.min(display.size.width, 1280);
  const capH = Math.round(display.size.height * (capW / display.size.width));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: capW, height: capH }
  });
  if (!sources.length) return { ok: false, error: 'no screen to capture' };
  return { ok: true, image: sources[0].thumbnail.toDataURL() };
});

ipcMain.handle('vision:read', async (_e, req) => {
  const url = req.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: req.model,
      stream: false,
      max_tokens: 350,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: req.prompt },
          { type: 'image_url', image_url: { url: req.image } }
        ]
      }]
    }),
    signal: AbortSignal.timeout(120000)
  });
  if (!res.ok) return { ok: false, error: 'HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200) };
  const j = await res.json();
  return { ok: true, text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '' };
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, '..', 'preload.js') } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'overlay.html'));

  const cap = await win.webContents.executeJavaScript('window.liveDesk.screenCapture()');
  if (!cap.ok) { console.log('VISION TEST FAILED: capture — ' + cap.error); app.quit(1); return; }
  console.log('[test] captured screen image (' + Math.round(cap.image.length / 1024) + ' KB)');

  const r = await win.webContents.executeJavaScript(`window.liveDesk.visionRead({
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'qwen3-vl:2b',
    image: ${JSON.stringify(cap.image)},
    prompt: 'Read this screenshot. If it shows a question, problem, task, code error, or anything the user might need to answer or act on, output exactly that text and nothing else. If there is nothing answerable, output a single short line describing what is on screen. No commentary.'
  })`);
  console.log('VISION RESULT ok=' + r.ok + ' text: ' + JSON.stringify((r.text || r.error || '').slice(0, 300)));
  app.quit();
}).catch((e) => { console.error('fatal', e); app.quit(1); });
