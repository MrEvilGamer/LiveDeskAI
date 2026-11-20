// Live end-to-end audio test: captures loopback with the app's real AudioEngine,
// speaks a sentence through the default output device via Windows TTS, and
// reports whether the VAD produces chunks and whether the local STT server
// transcribes them — through the app's real preload IPC path.
// Run:  npx electron scripts/test-audio.js   (start-stt.bat must be running)
const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

// exact copy of the stt:transcribe handler from main.js
ipcMain.handle('stt:transcribe', async (_e, req) => {
  console.log('[test] stt:transcribe audio type:', Object.prototype.toString.call(req.audio), 'len:', req.audio.byteLength ?? req.audio.length);
  const url = req.baseUrl.replace(/\/$/, '') + '/audio/transcriptions';
  const form = new FormData();
  form.append('file', new Blob([req.audio], { type: 'audio/wav' }), 'chunk.wav');
  form.append('model', req.model || 'base');
  form.append('response_format', 'json');
  if (req.language) form.append('language', req.language);
  const headers = {};
  if (req.apiKey) headers.Authorization = 'Bearer ' + req.apiKey;
  const res = await fetch(url, { method: 'POST', headers, body: form });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  return { text: (j && j.text) || '' };
});

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, p, cb) => cb(true));
  ses.setDisplayMediaRequestHandler((request, ...rest) => {
    const callback = rest.find((r) => typeof r === 'function');
    console.log('[test] display-media handler invoked');
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      console.log('[test] sources:', sources.length);
      if (sources.length) callback({ video: sources[0], audio: 'loopback' });
      else callback({});
    }).catch((e) => { console.log('[test] getSources failed', e); callback({}); });
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js')
    }
  });
  await win.loadFile(path.join(__dirname, 'test-audio.html'));

  // speak the test sentence out loud while the harness captures
  setTimeout(() => {
    const p = spawn('powershell', ['-NoProfile', '-Command',
      "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToDefaultAudioDevice(); $s.Speak('Testing live desk audio capture, one two three.'); $s.Dispose()"], { stdio: 'ignore' });
    p.on('error', (e) => console.log('[test] tts spawn failed:', e.message));
  }, 1500);

  const result = await win.webContents.executeJavaScript('runTest()');
  console.log('[test] RESULT ' + JSON.stringify(result, null, 2));
  app.exit(0);
}).catch((e) => { console.error('[test] fatal', e); app.exit(1); });
