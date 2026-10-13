import { createApp, loadEnv } from './app';
import { loadProviders, hasKey } from './adapters';

loadEnv();

const port = Number(process.env.PORT) || 8787;
createApp().listen(port, () => {
  const providers = loadProviders();
  const ready = Object.entries(providers).filter(([, v]) => hasKey(v)).map(([k]) => k);
  console.log(`Jejak AI server di http://localhost:${port}`);
  console.log(`API key terpasang untuk: ${ready.length ? ready.join(', ') : '(belum ada)'}`);
});
