import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAICompatible } from '../src/adapters/openaiCompatible';
import { AnthropicAdapter } from '../src/adapters/anthropic';
import { requestBytes, httpHeaderBytes } from '../src/adapters/types';
import type { StreamChunk } from '../src/adapters/types';

/** Upstream palsu yang bicara SSE seperti provider sungguhan, supaya adapter bisa diuji tanpa API key. */
function startMock(handler: (body: string, res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => handler(body, res));
  });
  return new Promise<{ url: string; close: () => Promise<void>; port: number }>(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => new Promise<void>(r => server.close(() => r())),
      });
    });
  });
}

async function collect(gen: AsyncGenerator<StreamChunk>) {
  let text = ''; let bytes = 0; let reqBytes = 0;
  const usage: { input_tokens?: number; output_tokens?: number } = {};
  for await (const c of gen) {
    if (c.delta) text += c.delta;
    bytes += c.bytes;
    if (c.reqBytes) reqBytes = c.reqBytes;
    if (c.usage) Object.assign(usage, c.usage);
  }
  return { text, bytes, reqBytes, usage };
}

describe('pengukuran byte', () => {
  it('header HTTP dihitung dari nilai yang benar-benar dikirim', () => {
    const headers = { 'Content-Type': 'application/json' };
    expect(httpHeaderBytes('POST', '/chat/completions', headers))
      .toBe('POST /chat/completions HTTP/1.1\r\nContent-Type: application/json\r\n\r\n'.length);
  });

  it('requestBytes = header + body, tanpa angka ajaib', () => {
    const headers = { 'Content-Type': 'application/json' };
    const body = '{"a":1}';
    expect(requestBytes('POST', '/x', headers, body))
      .toBe(httpHeaderBytes('POST', '/x', headers) + body.length);
  });
});

describe('OpenAICompatible', () => {
  let mock: Awaited<ReturnType<typeof startMock>>;
  beforeAll(async () => {
    mock = await startMock((_body, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Halo' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ' dunia' } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  afterAll(async () => { await mock.close(); });

  it('mengumpulkan delta, usage, dan byte respons yang benar', async () => {
    const a = new OpenAICompatible({ baseURL: mock.url, apiKey: 'k', model: 'mock-1' });
    const r = await collect(a.send({ messages: [{ role: 'user', content: 'Halo' }] }));
    expect(r.text).toBe('Halo dunia');
    expect(r.usage).toEqual({ input_tokens: 11, output_tokens: 7 });
    expect(r.bytes).toBeGreaterThan(0);
    expect(r.reqBytes).toBeGreaterThan(0);
  });

  it('mengirim model dan include_usage di body', async () => {
    let seen = '';
    const m2 = await startMock((body, res) => {
      seen = body;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: [DONE]\n\n');
    });
    const a = new OpenAICompatible({ baseURL: m2.url, apiKey: 'k', model: 'mock-2' });
    await collect(a.send({ messages: [{ role: 'user', content: 'hi' }] }));
    const j = JSON.parse(seen);
    expect(j.model).toBe('mock-2');
    expect(j.stream).toBe(true);
    expect(j.stream_options).toEqual({ include_usage: true });
    await m2.close();
  });

  it('tanpa usage: adapter tetap mengalir, token tidak dikarang', async () => {
    const m3 = await startMock((_body, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'tanpa usage' } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
    const a = new OpenAICompatible({ baseURL: m3.url, apiKey: 'k', model: 'mock-3' });
    const r = await collect(a.send({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(r.text).toBe('tanpa usage');
    expect(r.usage.input_tokens).toBeUndefined();
    await m3.close();
  });

  it('error upstream dilempar, bukan ditelan', async () => {
    const m4 = await startMock((_body, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"kunci salah"}');
    });
    const a = new OpenAICompatible({ baseURL: m4.url, apiKey: 'k', model: 'mock-4' });
    await expect(collect(a.send({ messages: [{ role: 'user', content: 'hi' }] }))).rejects.toThrow(/401/);
    await m4.close();
  });
});

describe('AnthropicAdapter', () => {
  it('membaca message_start, content_block_delta, message_delta', async () => {
    const mock = await startMock((_body, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`event: message_start\ndata: ${JSON.stringify({ message: { usage: { input_tokens: 20 } } })}\n\n`);
      res.write(`event: content_block_delta\ndata: ${JSON.stringify({ delta: { type: 'text_delta', text: 'Halo' } })}\n\n`);
      res.write(`event: content_block_delta\ndata: ${JSON.stringify({ delta: { type: 'text_delta', text: ' Anthropic' } })}\n\n`);
      res.write(`event: message_delta\ndata: ${JSON.stringify({ usage: { output_tokens: 9 } })}\n\n`);
      res.end();
    });
    const a = new AnthropicAdapter({ baseURL: mock.url, apiKey: 'k', model: 'claude-x' });
    const r = await collect(a.send({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(r.text).toBe('Halo Anthropic');
    expect(r.usage).toEqual({ input_tokens: 20, output_tokens: 9 });
    expect(r.bytes).toBeGreaterThan(0);
    await mock.close();
  });
});