#!/usr/bin/env node
// Menyalakan .env dari contoh dan menyiapkan folder data.
// Catatan: berkas .gitignore milik repositori dan TIDAK ditulis di sini —
// menulisnya dari skrip akan menimpa entri yang disunting tangan.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, 'server/.env.example');
const dst = path.join(root, 'server/.env');

if (fs.existsSync(dst)) {
  console.log('server/.env sudah ada, tidak ditimpa.');
} else {
  fs.copyFileSync(src, dst);
  console.log('server/.env dibuat dari .env.example. Isi key provider yang kamu pakai di file itu.');
}
fs.mkdirSync(path.join(root, 'server/data'), { recursive: true });