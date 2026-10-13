import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createRateLimiter } from '../src/security';

describe('token bucket', () => {
  it('melewatkan sampai kapasitas habis, lalu menolak', () => {
    let t = 1000;
    const rl = createRateLimiter({ capacity: 3, refillPerSecond: 1, now: () => t });
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(false);
    expect(rl.retryAfterMs('a')).toBe(1000);
  });

  it('mengisi ulang seiring waktu', () => {
    let t = 0;
    const rl = createRateLimiter({ capacity: 2, refillPerSecond: 2, now: () => t });
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(false);
    t += 500;                                  // +1 token
    expect(rl.take('a')).toBe(true);
    expect(rl.take('a')).toBe(false);
  });

  it('bucketing terpisah per kunci (per IP)', () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSecond: 0.0001, now: () => 0 });
    expect(rl.take('ip-a')).toBe(true);
    expect(rl.take('ip-b')).toBe(true);        // IP lain tidak terpengaruh
    expect(rl.take('ip-a')).toBe(false);
  });

  it('tidak menumpuk melebihi kapasitas meski lull panjang', () => {
    let t = 0;
    const rl = createRateLimiter({ capacity: 5, refillPerSecond: 1000, now: () => t });
    t += 60_000;                               // lull satu menit
    expect(rl.take('a', 5)).toBe(true);
    expect(rl.take('a', 1)).toBe(false);        // tidak melebihi 5 token
  });

  it('retryAfterMs 0 saat bucket masih penuh', () => {
    const rl = createRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => 0 });
    expect(rl.retryAfterMs('belum-pernah-dipakai')).toBe(0);
    rl.take('a');
    expect(rl.retryAfterMs('a')).toBe(0);
  });
});

/** Server uji dengan upstream mati: gate rate limit tetap terhitung walau prompt gagal. */
async function bootServer(opts: Parameters<typeof import('../src/app')['createApp']>[0]) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jejak-sec-'));
  const coefFile = path.join(tmpDir, 'coefficients.json');
  fs.writeFileSync(coefFile, JSON.stringify({
    uji: { name: 'Uji', kind: 'openai-compatible', baseURL: 'http://127.0.0.1:9/v1', keyEnv: 'UJI_KEY', model: 'uji-1', e_in: 0.05, e_out: 0.5, pue: 1.2, wue: 1.5 },
  }));
  process.env.COEFFICIENTS_FILE = coefFile;
  process.env.DATA_DIR = path.join(tmpDir, 'data');
  process.env.ENV_FILE = path.join(tmpDir, 'tidak-ada.env');
  process.env.UJI_KEY = 'k';

  const { createApp } = await import('../src/app');
  const server = createApp(opts).listen(0, '127.0.0.1');
  await new Promise<void>(r => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    chat: (headers: Record<string, string> = {}) => fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ provider: 'uji', messages: [{ role: 'user', content: 'halo' }] }),
    }),
    stop: () => { server.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); delete process.env.UJI_KEY; },
  };
}

describe('batas laju di route', () => {
  let s: Awaited<ReturnType<typeof bootServer>>;
  beforeAll(async () => {
    s = await bootServer({ rateLimit: { capacity: 2, refillPerSecond: 0.0001 } });
  });
  afterAll(() => s?.stop());

  it('dua prompt pertama lolos, berikutnya 429 + Retry-After', async () => {
    expect((await s.chat()).status).toBe(200);          // SSE dibuka, upstream-nya yang gagal
    expect((await s.chat()).status).toBe(200);
    const third = await s.chat();
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await third.json()).error).toMatch(/Terlalu banyak/);
  });

  it('endpoint baca tidak ikut dibatasi', async () => {
    expect((await fetch(`${s.url}/api/health`)).status).toBe(200);
    expect((await fetch(`${s.url}/api/history`)).status).toBe(200);
    expect((await fetch(`${s.url}/api/coefficients`)).status).toBe(200);
  });
});

describe('tanpa batas laju (default createApp)', () => {
  it('tidak pernah membalas 429', async () => {
    const s = await bootServer({});
    try {
      for (let i = 0; i < 5; i++) expect((await s.chat()).status).toBe(200);
    } finally {
      s.stop();
    }
  });
});

describe('AUTH_TOKEN', () => {
  it('endpoint kunci menuntut header x-jejak-token yang benar', async () => {
    const s = await bootServer({ authToken: 'rahasia' });
    try {
      expect((await s.chat()).status).toBe(401);
      const salah = await s.chat({ 'x-jejak-token': 'salah' });
      expect(salah.status).toBe(401);
      expect((await salah.json()).error).toMatch(/x-jejak-token/);

      // Token benar -> lolos gate, lalu gagal di upstream (masih 200 karena SSE).
      expect((await s.chat({ 'x-jejak-token': 'rahasia' })).status).toBe(200);

      // Endpoint baca tetap terbuka supaya halaman dasbor/metodologi bisa dipakai.
      expect((await fetch(`${s.url}/api/health`)).status).toBe(200);
      expect((await fetch(`${s.url}/api/history`)).status).toBe(200);
    } finally {
      s.stop();
    }
  });
});

describe('rateLimitFromEnv', () => {
  it('RATE_LIMIT=0 atau tidak valid berarti tanpa batas', async () => {
    const { rateLimitFromEnv } = await import('../src/app');
    const prev = process.env.RATE_LIMIT;
    process.env.RATE_LIMIT = '0';
    expect(rateLimitFromEnv()).toBeNull();
    process.env.RATE_LIMIT = 'abc';
    expect(rateLimitFromEnv()).toBeNull();
    process.env.RATE_LIMIT = '60';
    expect(rateLimitFromEnv()).toEqual({ capacity: 60, refillPerSecond: 1 });
    if (prev === undefined) delete process.env.RATE_LIMIT; else process.env.RATE_LIMIT = prev;
  });
});

describe('konfigurasi rusak tidak menggantungkan klien', () => {
  it('berkas koefisien hilang saat server hidup -> JSON error, bukan koneksi mati', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jejak-rusak-'));
    const coefFile = path.join(tmpDir, 'coefficients.json');
    fs.writeFileSync(coefFile, JSON.stringify({}));
    process.env.COEFFICIENTS_FILE = coefFile;
    process.env.DATA_DIR = path.join(tmpDir, 'data');
    process.env.ENV_FILE = path.join(tmpDir, 'tidak-ada.env');

    const { createApp } = await import('../src/app');
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise<void>(r => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      expect((await fetch(`${url}/api/health`)).status).toBe(200);
      fs.rmSync(coefFile);

      const health = await fetch(`${url}/api/health`);
      expect(health.status).toBe(500);
      expect((await health.json()).error).toMatch(/Gagal membaca berkas koefisien/);

      const chat = await fetch(`${url}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'x', messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(chat.status).toBe(500);
      expect((await chat.json()).error).toMatch(/Gagal membaca berkas koefisien/);
    } finally {
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('trust proxy dan identitas IP', () => {
  /** Satu server dengan kapasitas 1: siapa pun yang memakai IP kedua akan mendapat 429. */
  async function bootLimited(trustProxy: boolean | number | string) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jejak-proxy-'));
    const coefFile = path.join(tmpDir, 'coefficients.json');
    fs.writeFileSync(coefFile, JSON.stringify({
      uji: { name: 'Uji', kind: 'openai-compatible', baseURL: 'http://127.0.0.1:9/v1', keyEnv: 'UJI_KEY', model: 'uji-1', e_in: 0.05, e_out: 0.5, pue: 1.2, wue: 1.5 },
    }));
    process.env.COEFFICIENTS_FILE = coefFile;
    process.env.DATA_DIR = path.join(tmpDir, 'data');
    process.env.ENV_FILE = path.join(tmpDir, 'tidak-ada.env');
    process.env.UJI_KEY = 'k';

    const { createApp } = await import('../src/app');
    const server = createApp({ trustProxy, rateLimit: { capacity: 1, refillPerSecond: 0.0001 } }).listen(0, '127.0.0.1');
    await new Promise<void>(r => server.once('listening', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return {
      from: (ip: string) => fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body: JSON.stringify({ provider: 'uji', messages: [{ role: 'user', content: 'halo' }] }),
      }),
      stop: () => { server.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); delete process.env.UJI_KEY; },
    };
  }

  it('tanpa trust proxy, X-Forwarded-For diabaikan (satu kubus bersama)', async () => {
    const s = await bootLimited(false);
    try {
      expect((await s.from('10.0.0.1')).status).toBe(200);
      // Klien kedua mengirim IP berbeda, tapi server tetap melihat alamat proxy:
      // kuota dipakai bersama. Ini perilaku aman secara bawaan.
      expect((await s.from('10.0.0.2')).status).toBe(429);
    } finally {
      s.stop();
    }
  });

  it('dengan trust proxy 1 hop, tiap klien punya kuotanya sendiri', async () => {
    const s = await bootLimited(1);
    try {
      expect((await s.from('10.0.0.1')).status).toBe(200);
      expect((await s.from('10.0.0.2')).status).toBe(200);   // klien kedua punya kubus sendiri
      expect((await s.from('10.0.0.1')).status).toBe(429);    // klien pertama tetap kehabisan kuotanya
    } finally {
      s.stop();
    }
  });

  it('trustProxyFromEnv membaca boolean, hop, dan CIDR', async () => {
    const { trustProxyFromEnv } = await import('../src/app');
    const prev = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    expect(trustProxyFromEnv()).toBe(false);
    process.env.TRUST_PROXY = 'true'; expect(trustProxyFromEnv()).toBe(true);
    process.env.TRUST_PROXY = '2';   expect(trustProxyFromEnv()).toBe(2);
    process.env.TRUST_PROXY = 'loopback, 10.0.0.0/8'; expect(trustProxyFromEnv()).toBe('loopback, 10.0.0.0/8');
    process.env.TRUST_PROXY = 'false'; expect(trustProxyFromEnv()).toBe(false);
    if (prev === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = prev;
  });
});
