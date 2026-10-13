import { createApp, loadEnv, rateLimitFromEnv } from './app';
import { loadProviders, hasKey } from './adapters';

loadEnv();

const port = Number(process.env.PORT) || 8787;
// Bawaan: hanya loopback. Server ini memegang API key pengguna dan membayarkan setiap
// prompt, jadi tidak boleh terbuka ke jaringan tanpa disadari.
const host = process.env.HOST ?? '127.0.0.1';

const app = createApp({ serveClient: process.env.SERVE_CLIENT !== '0', rateLimit: rateLimitFromEnv() });
app.listen(port, host, () => {
  const providers = loadProviders();
  const ready = Object.entries(providers).filter(([, v]) => hasKey(v)).map(([k]) => k);
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  console.log(`Jejak AI server di http://${host}:${port}`);
  console.log(app.locals.servesClient
    ? 'Frontend dilayani dari client/dist (mode produksi). Jalankan `npm run build` dulu.'
    : 'Frontend belum dibangun; jalankan `npm run dev` untuk mode pengembangan.');
  console.log(app.locals.rateLimited
    ? `Batas laju aktif: ${process.env.RATE_LIMIT ?? 30} permintaan/menit per IP.`
    : 'Batas laju nonaktif (RATE_LIMIT=0 atau tidak diisi).');
  if (app.locals.authRequired) console.log('AUTH_TOKEN aktif: endpoint kunci butuh header x-jejak-token.');
  if (!loopback) {
    console.warn(`PERINGATAN: HOST=${host} membuat server bisa dijangkau dari jaringan lain. Setiap /api/chat memakai API key Anda. Setel AUTH_TOKEN atau kembalikan ke 127.0.0.1.`);
  }
  console.log(`API key terpasang untuk: ${ready.length ? ready.join(', ') : '(belum ada)'}`);
});