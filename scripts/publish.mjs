#!/usr/bin/env node
/**
 * Menerbitkan repo ini ke GitHub.
 *
 *   node scripts/publish.mjs            # buat repo privat lalu push
 *   node scripts/publish.mjs --public   # repo publik (sengaja)
 *   node scripts/publish.mjs --remote-only <URL>
 *
 * Aturan yang dijaga skrip ini:
 * - Tidak pernah menerima, membaca, atau menyimpan token. Login dilakukan oleh
 *   `gh auth login` di terminal Anda sendiri, atau oleh git/push yang menanyakan
 *   kredensial secara interaktif.
 * - Menolak jalan kalau `gh` belum terpasang atau belum terautentikasi.
 * - Menolak push kalau ada secret yang mencurigakan di working tree.
 *
 * Jalankan manual, bukan bagian dari npm test atau CI.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const Only = args.includes('--public');
const remoteIdx = args.indexOf('--remote-only');
const remoteUrl = remoteIdx !== -1 ? args[remoteIdx + 1] : null;
const NAMA = 'jejak-ai';

const jalan = (cmd, argv, opts = {}) => spawnSync(cmd, argv, { cwd: root, encoding: 'utf8', ...opts });
const punya = (cmd) => spawnSync('command', ['-v', cmd], { shell: true }).status === 0;

/** Berhenti dengan pesan yang bisa dibaca. `saran` boleh string tunggal atau daftar baris. */
function gagal(pesan, saran = []) {
  console.error(`\n${pesan}\n`);
  for (const baris of [].concat(saran)) console.error(baris);
  console.error('');
  process.exit(1);
}

// 1. Syarat: git ada dan working tree bersih.
if (!punya('git')) gagal('git tidak ditemukan.', ['Pasang git lalu ulangi.']);
const status = jalan('git', ['status', '--porcelain']);
if (status.status !== 0) gagal('Bukan repositori git.');
if (status.stdout.trim()) {
  gagal('Working tree belum bersih — commit dulu sebelum menerbitkan.', status.stdout.trim().split('\n').slice(0, 5).join('\n'));
}

// 2. Syarat: tidak ada secret yang jelas di working tree.
const pola = [
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/, nama: 'token GitHub' },
  { re: /github_pat_[A-Za-z0-9_]{20,}/, nama: 'token GitHub (fine-grained)' },
  { re: /\bsk-[A-Za-z0-9]{32,}/, nama: 'API key OpenAI' },
  { re: /\bsk-ant-[A-Za-z0-9-]{20,}/, nama: 'API key Anthropic' },
  { re: /AIza[0-9A-Za-z_-]{30,}/, nama: 'API key Google' },
];
const cwd = path.join(root, '.git') ? root : root;
const file = [];
(function kumpulkan(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'data', 'test-results', 'playwright-report'].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) kumpulkan(p);
    else if (/\.(ts|tsx|js|mjs|json|md|css|yml|yaml|env|example)$/.test(ent.name) || ent.name === '.env') file.push(p);
  }
})(cwd);

const temuan = [];
for (const f of file) {
  const teks = fs.readFileSync(f, 'utf8');
  for (const { re, nama } of pola) {
    if (re.test(teks)) temuan.push(`${path.relative(root, f)} (${nama})`);
  }
}
if (temuan.length) {
  gagal('Ditemukan pola secret di working tree. Batalkan push.', temuan);
}
console.log(`Pemeriksaan secret: bersih (${file.length} berkas diperiksa).`);

// 3. Mode remote-only: hanya pasang remote lalu push dengan kredensial interaktif.
if (remoteUrl) {
  const ada = jalan('git', ['remote']).stdout.includes('origin');
  console.log(ada ? 'Remote origin sudah ada, tidak diubah.' : `Menambahkan remote origin: ${remoteUrl}`);
  if (!ada) {
    const add = jalan('git', ['remote', 'add', 'origin', remoteUrl]);
    if (add.status !== 0) gagal('Gagal menambah remote.', [add.stderr]);
  }
  const push = spawnSync('git', ['push', '-u', 'origin', 'main'], { cwd: root, stdio: 'inherit' });
  if (push.status !== 0) gagal('Push gagal. Periksa kredensial atau URL remote.');
  console.log('Terpush. Buka repo untuk melihat hasil CI.');
  process.exit(0);
}

// 4. Mode gh: buat repo lalu push.
if (!punya('gh')) {
  gagal('`gh` belum terpasang, jadi repo tidak bisa dibuat otomatis.', [
    'Pilihan A (paling cepat):',
    '  brew install gh            # macOS',
    '  sudo apt install gh        # Debian/Ubuntu',
    '  lalu: gh auth login        # JALANKAN ANDA SENDIRI, jangan tempel token ke mana pun',
    '  setelah itu ulangi: node scripts/publish.mjs',
    '',
    'Pilihan B (tanpa gh):',
    '  1. Buat repo kosong di github.com lewat browser (pilih Private).',
    '  2. Jalankan:',
    '     node scripts/publish.mjs --remote-only https://github.com/<user>/jejak-ai.git',
    '     git akan menanyakan kredensial Anda sendiri saat push.',
  ]);
}

const auth = jalan('gh', ['auth', 'status']);
if (auth.status !== 0) {
  gagal('`gh` belum terautentikasi.', [
    'Jalankan `gh auth login` di terminal Anda sendiri, lalu ulangi skrip ini.',
    'Skrip ini sengaja tidak menerima token sebagai argumen.',
  ]);
}

const vis = Only ? '--public' : '--private';
const buat = jalan('gh', ['repo', 'create', NAMA, vis, '--source=.', '--remote=origin', '--push', '--description',
  'Jejak AI: estimasi air, listrik, dan data yang dipakai tiap prompt ke provider AI. Air dan listrik = estimasi (dengan rentang); token dan byte = terukur.']);
if (buat.status !== 0) {
  console.error(buat.stderr || buat.stdout);
  gagal('Gagal membuat repo. Kalau repo dengan nama itu sudah ada, pakai:',
    `  node scripts/publish.mjs --remote-only https://github.com/<user>/${NAMA}.git`);
}
console.log(`\nRepo ${vis === '--public' ? 'publik' : 'privat'} dibuat dan terpush.`);
console.log('Buka tab Actions di repo untuk melihat CI berjalan.');