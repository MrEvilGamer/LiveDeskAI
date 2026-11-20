// Renders a spoken+code answer through the real overlay and screenshots it.
// Runs in its own userData dir so it can run next to the packaged app.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.setPath('userData', path.join(require('os').tmpdir(), 'livedesk-test'));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 440, height: 640, frame: false, transparent: true, webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, '..', 'preload.js') } });
  await win.loadFile(path.join(__dirname, '..', 'src', 'overlay.html'), { search: 'demo=1' });
  await new Promise((r) => setTimeout(r, 1500));

  const FENCE = String.fromCharCode(96, 96, 96); // ```
  const sample = [
    'I can write a service method \u2014 here\u2019s a clean one:',
    '',
    FENCE + 'js',
    'serviceMethod = (data) => {',
    '  return data.map(d => ({ id: d.id, name: d.name }));',
    '};',
    FENCE,
    '',
    'I\u2019ve used this pattern on several API integration projects.'
  ].join('\n');

  await win.webContents.executeJavaScript('renderAnswer(' + JSON.stringify(sample) + ', false)');
  win.show();
  await new Promise((r) => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  for (let i = 0; i < 10; i++) { if (!img.isEmpty()) break; await new Promise(r => setTimeout(r, 250)); }
  fs.writeFileSync(path.join(__dirname, '..', 'smoke-answer.png'), img.toPNG());
  console.log('answer shot written');
  app.quit();
}).catch((e) => { console.error('fatal', e); app.quit(1); });
