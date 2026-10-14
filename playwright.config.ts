import { defineConfig, devices } from '@playwright/test';
import { E2E_DATA_DIR } from './e2e/env';

/**
 * E2E memakai build produksi (client/dist dilayani Express), bukan dev server.
 * Jadi yang diuji persis yang You'd ship: satu proses, satu origin, SSE lewat
 * /api/chat yang sama seperti di produksi.
 *
 *   npm run test:e2e
 *
 * Browser: `npx playwright install chromium` (di Cache pada CI secara otomatis).
 * @playwright/test sengaja dikunci ke versi yang cocok dengan chromium yang dipakai
 * supaya instalasi tidak mengunduh apa pun kalau browsernya sudah ada.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${process.env.E2E_PORT ?? 8799}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'id-ID',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run test:e2e:server',
    url: `http://127.0.0.1:${process.env.E2E_PORT ?? 8799}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: process.env.E2E_PORT ?? '8799',
      HOST: '127.0.0.1',
      // Database terpisah: tes boleh mengisi riwayat tanpa mengotori server/data/.
      DATA_DIR: E2E_DATA_DIR,
      // Batas laju longgar supaya tes tidak saling。それでも menguji presence-nya.
      RATE_LIMIT: process.env.E2E_RATE_LIMIT ?? '600',
    },
  },
});