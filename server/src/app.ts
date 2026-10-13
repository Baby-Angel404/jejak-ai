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

export function createApp(opts: { serveClient?: boolean } = {}) {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    const providers = loadProviders();
    res.json({
      ok: true,
      providers: Object.fromEntries(Object.entries(providers).map(([k, v]) => [k, { name: v.name, model: v.model, hasKey: hasKey(v) }])),
    });
  });

  app.post('/api/chat', chatRoute);
  app.post('/api/compare', compareRoute);
  app.get('/api/history', historyRoute);
  app.get('/api/export.csv', exportCsvRoute);
  app.get('/api/export.json', exportJsonRoute);
  app.get('/api/coefficients', getCoefficientsRoute);
  app.put('/api/coefficients/:provider', putCoefficientsRoute);
  app.post('/api/coefficients/reset', resetCoefficientsRoute);

  const served = opts.serveClient ? serveClient(app) : false;
  app.locals.servesClient = served;

  app.use((_req, res) => { res.status(404).json({ error: 'Endpoint tidak ada' }); });
  return app;
}