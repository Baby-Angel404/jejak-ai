import { createApp, loadEnv } from './app';
import { loadProviders, hasKey } from './adapters';

loadEnv();

const port = Number(process.env.PORT) || 8787;
// Mode produksi: layani juga bundle client bila sudah dibangun (npm run build).
const app = createApp({ serveClient: process.env.SERVE_CLIENT !== '0' });
app.listen(port, () => {
  const providers = loadProviders();
  const ready = Object.entries(providers).filter(([, v]) => hasKey(v)).map(([k]) => k);
  console.log(`Jejak AI server di http://localhost:${port}`);
  console.log(app.locals.servesClient
    ? 'Frontend dilayani dari client/dist (mode produksi). Jalankan `npm run build` dulu.'
    : 'Frontend belum dibangun; jalankan `npm run dev` untuk mode pengembangan.');
  console.log(`API key terpasang untuk: ${ready.length ? ready.join(', ') : '(belum ada)'}`);
});