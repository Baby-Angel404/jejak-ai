// Server palsu yang meniru OpenAI /chat/completions (streaming + usage) untuk uji lokal tanpa API key.
import http from 'node:http';
http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const words = 'Fotosintesis adalah proses ketika tumbuhan mengubah cahaya menjadi energi kimia'.split(' ');
  let i = 0;
  const t = setInterval(() => {
    if (i < words.length) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: words[i++] + ' ' } }] })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 18, completion_tokens: 42 } })}\n\n`);
      res.write('data: [DONE]\n\n'); res.end(); clearInterval(t);
    }
  }, 60);
}).listen(9999, () => console.log('mock upstream :9999'));
