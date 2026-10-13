import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Tes route HTTP dengan upstream palsu, berkas koefisien sementara, dan DATA_DIR
 * sementara: tidak menyentuh config/coefficients.json, tidak memanggil API sungguhan,
 * dan tidak mengotori database riwayat yang dipakai aplikasi.
 */
let upstream: { url: string; close: () => Promise<void> };
let app: { close: () => void; url: string };
let tmpDir: string;

async function startUpstream() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const model = (JSON.parse(body || '{}').model) || 'mock';
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // Model "lambat" lebih lambat supaya paralelisme benar-benar terlihat.
      const gap = model.includes('lambat') ? 40 : 8;
      const words = ['Satu', 'dua', 'tiga', 'empat'];
      let i = 0;
      const t = setInterval(() => {
        if (i < words.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${words[i++]} ` } }] })}\n\n`);
        else {
          res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 30 } })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          clearInterval(t);
        }
      }, gap);
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/v1`, close: () => new Promise<void>(r => server.close(() => r())) };
}

async function collectSSE(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const events: { event: string; data: any }[] = [];
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      let event = 'message';
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) events.push({ event, data: JSON.parse(data.join('\n')) });
    }
  }
  return events;
}

const post = (p: string, body: unknown) => fetch(`${app.url}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

beforeAll(async () => {
  upstream = await startUpstream();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jejak-test-'));

  const coefFile = path.join(tmpDir, 'coefficients.json');
  const mk = (id: string, baseURL: string, model: string, e_out: number) => ({
    name: id, kind: 'openai-compatible', baseURL, keyEnv: `${id.toUpperCase()}_KEY`,
    model, e_in: 0.05, e_out, pue: 1.2, wue: 1.8, sumber: 'tes',
  });
  fs.writeFileSync(coefFile, JSON.stringify({
    cepat: mk('Cepat', upstream.url, 'model-cepat', 0.5),
    lambat: mk('Lambat', upstream.url, 'model-lambat', 0.9),
    rusak: mk('Rusak', 'http://127.0.0.1:9/v1', 'model-rusak', 0.5),
  }, null, 2));

  process.env.COEFFICIENTS_FILE = coefFile;
  process.env.DATA_DIR = path.join(tmpDir, 'data');
  process.env.ENV_FILE = path.join(tmpDir, 'tidak-ada.env');
  for (const id of ['CEPAT', 'LAMBAT', 'RUSAK']) process.env[`${id}_KEY`] = 'kunci-uji';

  const { createApp } = await import('../src/app');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  app = { close: () => server.close(), url: `http://127.0.0.1:${port}` };
});

afterAll(async () => {
  app?.close();
  await upstream?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  for (const id of ['CEPAT', 'LAMBAT', 'RUSAK']) delete process.env[`${id}_KEY`];
});

describe('POST /api/compare', () => {
  it('menolak jumlah provider di luar 2-3', async () => {
    expect((await post('/api/compare', { prompt: 'halo', providers: ['cepat'] })).status).toBe(400);
    expect((await post('/api/compare', { prompt: 'halo', providers: ['a', 'b', 'c', 'd'] })).status).toBe(400);
  });

  it('menolak prompt kosong, provider asing, dan provider dobel', async () => {
    expect((await post('/api/compare', { prompt: '   ', providers: ['cepat', 'lambat'] })).status).toBe(400);
    expect((await post('/api/compare', { prompt: 'halo', providers: ['cepat', 'ngawur'] })).status).toBe(400);
    expect((await post('/api/compare', { prompt: 'halo', providers: ['cepat', 'cepat'] })).status).toBe(400);
  });

  it('menolak provider yang tidak punya baseURL di .env', async () => {
    const res = await post('/api/compare', { prompt: 'halo', providers: ['cepat', 'custom'] });
    expect(res.status).toBe(400);
  });

  it('menjalankan 2 provider paralel dan menandai setiap event dengan tag', async () => {
    const res = await post('/api/compare', { prompt: 'Bandingkan dua provider', providers: ['cepat', 'lambat'] });
    expect(res.status).toBe(200);
    const events = await collectSSE(res);

    const start = events.find(e => e.event === 'compare-start');
    expect(start?.data.items.map((i: any) => i.tag).sort()).toEqual(['cepat', 'lambat']);

    for (const tag of ['cepat', 'lambat']) {
      const tokens = events.filter(e => e.event === 'token' && e.data.tag === tag);
      expect(tokens.map(e => e.data.delta).join('')).toBe('Satu dua tiga empat ');
      const done = events.find(e => e.event === 'done' && e.data.tag === tag)!.data;
      expect(done.estimated).toBe(false);
      expect(done.tokensOut).toBe(30);
      expect(done.bytes).toBeGreaterThan(0);
      expect(done.range.ml.high).toBeCloseTo(done.ml * 3, 12);
      expect(done.range.ml.low).toBeCloseTo(done.ml * 0.4, 12);
    }

    // e_out lebih besar -> listrik dan air lebih besar.
    const doneCepat = events.find(e => e.event === 'done' && e.data.tag === 'cepat')!.data;
    const doneLambat = events.find(e => e.event === 'done' && e.data.tag === 'lambat')!.data;
    expect(doneLambat.wh).toBeGreaterThan(doneCepat.wh);
    expect(doneLambat.ml).toBeGreaterThan(doneCepat.ml);

    const last = events[events.length - 1];
    expect(last.event).toBe('compare-done');
    expect(last.data.results.length).toBe(2);
  }, 20_000);

  it('satu jalur gagal tidak menggagalkan jalur lain', async () => {
    const res = await post('/api/compare', { prompt: 'halo', providers: ['cepat', 'rusak'] });
    expect(res.status).toBe(200);
    const events = await collectSSE(res);

    const err = events.find(e => e.event === 'error' && e.data.tag === 'rusak');
    expect(err?.data.message).toMatch(/fetch failed|ECONNREFUSED|1|9/);

    const done = events.find(e => e.event === 'done' && e.data.tag === 'cepat');
    expect(done?.data.tokensOut).toBe(30);

    const last = events[events.length - 1];
    expect(last.event).toBe('compare-done');
    expect(last.data.results.find((r: any) => r.tag === 'rusak').error).toBeTruthy();
    expect(last.data.results.find((r: any) => r.tag === 'cepat').done.tokensOut).toBe(30);
  }, 20_000);
});

describe('GET /api/history', () => {
  it('mengembalikan baris beserta ringkasan total', async () => {
    const json = await (await fetch(`${app.url}/api/history?limit=10`)).json();
    expect(json.rows.length).toBeGreaterThan(0);
    expect(json.total.prompts).toBe(json.rows.length);
    expect(json.total.ml).toBeCloseTo(json.rows.reduce((n: number, r: any) => n + r.ml, 0), 12);
  });

  it('menyaring per provider dan per rentang waktu', async () => {
    const byProvider = await (await fetch(`${app.url}/api/history?provider=lambat`)).json();
    expect(byProvider.rows.every((r: any) => r.provider === 'lambat')).toBe(true);

    const empty = await (await fetch(`${app.url}/api/history?from=${Date.now() + 60_000}`)).json();
    expect(empty.rows.length).toBe(0);
  });

  it('ekspor CSV dan JSON memakai bentuk yang konsisten', async () => {
    const csv = await (await fetch(`${app.url}/api/export.csv`)).text();
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('ts_iso,provider,model,tokens_in,tokens_out,tokens_estimated,bytes,wh_est,ml_est');
    expect(lines.length).toBeGreaterThan(1);

    const json = await (await fetch(`${app.url}/api/export.json`)).json();
    expect(json.rows.length).toBe(lines.length - 1);
    expect(json.disclaimer).toMatch(/ESTIMASI/i);
  });
});

describe('koefisien', () => {
  it('GET hanya mengirim hasKey, tidak pernah nilai key', async () => {
    const json = await (await fetch(`${app.url}/api/coefficients`)).json();
    expect(Object.keys(json).sort()).toEqual(['cepat', 'lambat', 'rusak']);
    expect(json.cepat.hasKey).toBe(true);
    expect(JSON.stringify(json)).not.toContain('kunci-uji');
  });

  it('PUT menolak nilai negatif dan menyimpan nilai valid', async () => {
    const bad = await fetch(`${app.url}/api/coefficients/cepat`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ e_out: -1 }),
    });
    expect(bad.status).toBe(400);

    const badYear = await fetch(`${app.url}/api/coefficients/cepat`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tahun: 1800 }),
    });
    expect(badYear.status).toBe(400);

    const ok = await fetch(`${app.url}/api/coefficients/cepat`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ e_out: 0.75, sumber: 'uji', tahun: 2025 }),
    });
    expect(ok.status).toBe(200);
    const after = await (await fetch(`${app.url}/api/coefficients`)).json();
    expect(after.cepat.e_out).toBe(0.75);
    expect(after.cepat.sumber).toBe('uji');
    expect(after.cepat.tahun).toBe(2025);
  });

  it('PUT ke provider yang tidak ada = 404', async () => {
    const res = await fetch(`${app.url}/api/coefficients/hantu`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ e_out: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it('reset mengembalikan koefisien bawaan', async () => {
    const res = await fetch(`${app.url}/api/coefficients/reset`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'cepat' }),
    });
    // Default repo tidak punya provider 'cepat', jadi harus gagal dengan pesan jelas.
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/tidak ada di daftar default/);
  });
});