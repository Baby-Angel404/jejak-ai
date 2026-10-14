#!/usr/bin/env node
/**
 * Menjalankan mode nyata tanpa API key sungguhan:
 *   - mock upstream yang bicara OpenAI-compatible (server/test/mock-upstream.mjs)
 *   - backend dengan CUSTOM_BASE_URL dan CUSTOM_API_KEY yang diarahkan ke mock itu
 *   - server dev Vite untuk frontend
 *
 * Satu perintah: `npm run dev:mock`. Ctrl+C menutup ketiganya.
 * Env ditulis lewat spawn (bukan awalan `VAR=x` di shell) supaya perilakunya sama
 * di Linux, macOS, dan Windows.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 9999);
const API_PORT = Number(process.env.PORT ?? 8787);

const anak = [];
let shuttingDown = false;

function jalankan(nama, perintah, args, env = {}, cwd = root) {
  const child = spawn(perintah, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n[${nama}] berhenti (${signal ?? code}) — menutup yang lain.`);
    stop(code ?? 1);
  });
  anak.push({ nama, child });
  return child;
}

function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of anak) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 150);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

// Pastikan server/.env ada supaya dotenv tidak mengeluh.
const envFile = path.join(root, 'server/.env');
if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(root, 'server/.env.example'), envFile);
}

jalankan('mock', process.execPath, ['server/test/mock-upstream.mjs'], { MOCK_PORT: String(MOCK_PORT) });
jalankan('server', process.execPath, ['node_modules/.bin/tsx', 'server/src/index.ts'], {
  PORT: String(API_PORT),
  CUSTOM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
  CUSTOM_API_KEY: 'kunci-palsu-untuk-mode-mock',
  RATE_LIMIT: process.env.RATE_LIMIT ?? '0',   // mock tidak memakai uang sungguhan
});
// Vite harus dijalankan dari folder client: di sana index.html dan vite.config.ts.
jalankan('client', process.execPath, [path.join(root, 'node_modules/.bin/vite'), '--host', '127.0.0.1'], {
  API_URL: `http://127.0.0.1:${API_PORT}`,
}, path.join(root, 'client'));

console.log(`\nMode mock aktif. Buka http://127.0.0.1:5173 lalu pilih mode "Kirim prompt".`);
console.log('Provider "Custom" terisi dan mengarah ke mock lokal — tidak ada API key sungguhan.\n');