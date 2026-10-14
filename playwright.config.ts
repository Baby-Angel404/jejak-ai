import { defineConfig, devices } from '@playwright/test';
import { E2E_COEFFICIENTS_FILE, E2E_DATA_DIR, MOCK_PORT } from './e2e/env';

/**
 * E2E memakai build produksi (client/dist dilayani Express), bukan dev server.
 * Jadi yang diuji persis yang akan dikirim: satu proses, satu origin, SSE lewat
 * /api/chat yang sama seperti di produksi.
 *
 *   npm run build && npm run test:e2e
 *
 * Dua proses dijalankan: mock upstream yang bicara OpenAI-compatible, lalu aplikasi
 * yang menghadapinya. Dengan begitu jalur mode nyata ikut teruji:
 * browser -> Express -> adapter -> SSE -> token & byte terukur.
 *
 * Browser: `npx playwright install chromium`. @playwright/test dikunci ke rilis yang
 * memakai chromium-1243, jadi instalasi lokal tidak mengunduh apa pun kalau browser
 * sudah ada di ~/.cache/ms-playwright.
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
  webServer: [
    {
      command: 'node server/test/mock-upstream.mjs',
      url: `http://127.0.0.1:${MOCK_PORT}/`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { MOCK_PORT: String(MOCK_PORT) },
    },
    {
      command: 'npm run test:e2e:server',
      url: `http://127.0.0.1:${process.env.E2E_PORT ?? 8799}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: process.env.E2E_PORT ?? '8799',
        HOST: '127.0.0.1',
        // Database terpisah: tes boleh mengisi riwayat tanpa mengotori server/data/.
        DATA_DIR: E2E_DATA_DIR,
        // Satu provider palsu untuk E2E; "key"-nya tidak pernah dipakai ke mana pun.
        COEFFICIENTS_FILE: E2E_COEFFICIENTS_FILE,
        MOCK_API_KEY: 'kunci-palsu-untuk-e2e',
        MOCK_LAMBAT_KEY: 'kunci-palsu-untuk-e2e',
        RATE_LIMIT: process.env.E2E_RATE_LIMIT ?? '600',
      },
    },
  ],
});