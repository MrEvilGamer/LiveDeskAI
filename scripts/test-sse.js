// Verifies the SSE parsing loop used in main.js llm:chat against a mock
// OpenAI-compatible server that deliberately splits lines across chunks.
const http = require('http');

const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  let i = 0;
  const t = setInterval(() => {
    if (i === 0) res.write('data: {"choices":[{"delta":{"content":"Hel');
    if (i === 1) res.write('lo"}}]}\n\n');
    if (i === 2) res.write('data: {"choices":[{"delta":{"content":" there"}}]}\n\n');
    if (i === 3) res.write('data: [DONE]\n\n');
    if (++i > 3) { clearInterval(t); res.end(); }
  }, 30);
});

srv.listen(0, async () => {
  const port = srv.address().port;
  const res = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', { method: 'POST', body: '{}' });
  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('event-stream')) throw new Error('unexpected content-type ' + ctype);

  // — same parsing loop as main.js llm:chat —
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') {
        srv.close();
        if (out === 'Hello there') { console.log('STREAM OK:', JSON.stringify(out)); process.exit(0); }
        console.log('STREAM MISMATCH:', JSON.stringify(out));
        process.exit(1);
      }
      try {
        const j = JSON.parse(data);
        const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (d) out += d;
      } catch (e) {
        console.log('parse error:', e.message);
      }
    }
  }
  console.log('ended without DONE');
  process.exit(1);
});
