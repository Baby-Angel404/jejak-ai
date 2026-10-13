#!/usr/bin/env node
// Salin .env.example -> .env kalau belum ada. API key hanya tinggal di server/.env.
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
fs.writeFileSync(path.join(root, '.gitignore'), `node_modules/
dist/
server/.env
server/data/
*.local
.DS_Store
`);
console.log('.gitignore ditulis.');