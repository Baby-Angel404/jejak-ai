import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { chatRoute } from './routes/chat';
import { compareRoute } from './routes/compare';
import { historyRoute, exportCsvRoute, exportJsonRoute } from './routes/history';
import { getCoefficientsRoute, putCoefficientsRoute, resetCoefficientsRoute } from './routes/coefficients';
import { loadProviders, hasKey } from './adapters';
import type { ProviderEntry } from '../../shared/types';
import { createRateLimiter, rateLimit, requireToken, type Limiter } from './security';

const here = path.dirname(fileURLToPath(import.meta.url));

// .env dibaca dari server/.env, bukan dari direktori kerja, supaya `npm run dev`
// dari root dan dari server/ hasilnya sama.
export function loadEnv(): void {
  dotenv.config({ path: process.env.ENV_FILE ?? path.resolve(here, '../.env') });
}

/**
 * Bila `client/dist` sudah dibangun, layani juga sebagai SPA dari origin yang sama.
 * Gunanya satu: produksi bisa jalan dengan satu proses saja (tanpa CORS, tanpa
 * server kedua), dan SSE tetap lewat origin yang sama. Route /api selalu menang
 * karena diletakkan lebih dulu.
 */
function serveClient(app: express.Express): boolean {
  const dist = process.env.CLIENT_DIST ?? path.resolve(here, '../../client/dist');
  const index = path.join(dist, 'index.html');
  if (!fs.existsSync(index)) return false;
  app.use(express.static(dist, { index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => { res.sendFile(index); });
  return true;
}

/** Baca koefisien; kalau berkasnya hilang/rusak, pesannya jelas bukan ENOENT mentah. */
function safeProviders(): Record<string, ProviderEntry> {
  try {
    return loadProviders();
  } catch (e) {
    throw Object.assign(new Error(
      `Gagal membaca berkas koefisien (${(e as Error).message}). Cek COEFFICIENTS_FILE atau server/config/coefficients.json.`,
    ), { status: 500 });
  }
}

/**
 * Nilai untuk `app.set('trust proxy')`. Di belakang reverse proxy, Express membaca
 * `req.ip` dari X-Forwarded-For hanya kalau ini diaktifkan; kalau tidak, semua
 * permintaan terlihat berasal dari alamat proxy sehingga rate limit dan log menyatu.
 * Bawaannya DIMATIKAN supaya alamat X-Forwarded-For dari klien tidak bisa dipalsukan.
 * Bentuk yang diterima: boolean, jumlah hop (number), atau CIDR/ungkapan comma.
 */
export function trustProxyFromEnv(): boolean | number | string {
  const raw = process.env.TRUST_PROXY;
  if (!raw) return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

export interface AppOptions {
  serveClient?: boolean;
  /** Diisi = mengabaikan TRUST_PROXY env (dipakai tes). */
  trustProxy?: boolean | number | string;
  /** null = tanpa batas; kalau diisi, nilai ini mengabaikan RATE_LIMIT */
  rateLimit?: { capacity: number; refillPerSecond: number } | null;
  authToken?: string;
}

/** Default: 30 prompt per menit per IP. 0 atau tidak(set) berarti tanpa batas. */
export function rateLimitFromEnv(): { capacity: number; refillPerSecond: number } | null {
  const perMinute = Number(process.env.RATE_LIMIT ?? 30);
  if (!Number.isFinite(perMinute) || perMinute <= 0) return null;
  return { capacity: perMinute, refillPerSecond: perMinute / 60 };
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  const trust = opts.trustProxy ?? trustProxyFromEnv();
  app.set('trust proxy', trust);
  app.locals.trustProxy = trust;
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }));
  app.use(express.json({ limit: '1mb' }));

  const limiter: Limiter | null = opts.rateLimit ? createRateLimiter(opts.rateLimit) : null;
  const limit = rateLimit(limiter);
  // Endpoint yang menyentuh API key atau mengubah koefisien dilindungi token bila diset.
  const gate = requireToken(opts.authToken ?? process.env.AUTH_TOKEN);
  const guarded: express.RequestHandler[] = [...(gate ? [gate] : []), limit];

  app.get('/api/health', (_req, res) => {
    const providers = safeProviders();
    res.json({
      ok: true,
      providers: Object.fromEntries(Object.entries(providers).map(([k, v]) => [k, { name: v.name, model: v.model, hasKey: hasKey(v) }])),
    });
  });

  app.post('/api/chat', ...guarded, chatRoute);
  app.post('/api/compare', ...guarded, compareRoute);
  app.get('/api/history', historyRoute);
  app.get('/api/export.csv', exportCsvRoute);
  app.get('/api/export.json', exportJsonRoute);
  app.get('/api/coefficients', getCoefficientsRoute);
  app.put('/api/coefficients/:provider', ...guarded, putCoefficientsRoute);
  app.post('/api/coefficients/reset', ...guarded, resetCoefficientsRoute);

  const served = opts.serveClient ? serveClient(app) : false;
  app.locals.servesClient = served;
  app.locals.rateLimited = !!limiter;
  app.locals.authRequired = !!gate;

  app.use((_req, res) => { res.status(404).json({ error: 'Endpoint tidak ada' }); });

  // Selalu balas JSON, jangan biarkan koneksi ditutup tanpa jawaban: klien SSE
  // harus bisa menampilkan pesan yang bisa dibaca manusia.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = Number(err?.status) >= 400 && Number(err?.status) < 600 ? Number(err.status) : 500;
    if (res.headersSent) { res.end(); return; }
    res.status(status).json({ error: err?.message ?? 'Terjadi kesalahan di server' });
  });

  return app;
}