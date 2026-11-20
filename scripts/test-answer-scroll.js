const { app, BrowserWindow } = require('electron');
const path = require('path');
app.setPath('userData', path.join(require('os').tmpdir(), 'livedesk-scroll-test'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 440, height: 640, show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadFile(path.join(__dirname, '..', 'src', 'overlay.html'), { search: 'demo=1' });
    win.show();
    const result = await win.webContents.executeJavaScript(`(async () => {
      const wait = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const panel = document.querySelector('#answerText');
      let text = Array.from({length: 80}, (_, i) => 'Line ' + i + ': a long streaming answer to read.').join('\\n');
      renderAnswer(text, true); await wait();
      const node = panel.firstElementChild;
      panel.dispatchEvent(new WheelEvent('wheel', {deltaY: -100}));
      panel.scrollTop = 40; await wait();
      for (let i = 0; i < 15; i++) { text += '\\nNew streaming text ' + i; renderAnswer(text, true); await wait(); }
      const preserved = Math.abs(panel.scrollTop - 40) < 2;
      const reused = panel.firstElementChild === node;
      panel.scrollTop = panel.scrollHeight; await wait();
      renderAnswer(text + '\\nFinal arriving text', false); await wait();
      const resumed = panel.scrollHeight - panel.clientHeight - panel.scrollTop < 5;
      const clean = !panel.textContent.includes('Click') && !panel.textContent.includes('Answers appear here');
      return {preserved, reused, resumed, clean};
    })()`);
    console.log(JSON.stringify(result));
    app.exit(Object.values(result).every(Boolean) ? 0 : 1);
  } catch (e) { console.error(e); app.exit(1); }
});
