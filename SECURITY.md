# Keamanan

## Melaporkan kerentanan

Jangan membuka issue publik untuk celah keamanan. Laporkan lewat
**Security Advisory** repo ini, yang langsung masuk ke tim pemelihara secara
privat dan bisa dibuat draft tanpa issues publik:

👉 https://github.com/Baby-Angel404/jejak-ai/security/advisories/new

Sertakan: langkah reproduksi, versi (commit), dampak yang Anda perkirakan, dan
bukti jika ada. Balasan Informal biasanya dalam beberapa hari.

## Batasan yang sudah diketahui

Jejak AI memegang API key Anda di `server/.env` dan meneruskan setiap prompt ke
provider. Sudah ada bipartisi:

- `HOST` bawaan `127.0.0.1`, jadi server tidak otomatis terbuka ke jaringan.
- `RATE_LIMIT` membatasi endpoint yang memakai key (token bucket per IP).
- `AUTH_TOKEN` opsional untuk `/api/chat`, `/api/compare`, dan perubahan koefisien.
- CSV escaping mencegah injeksi formula spreadsheet saat ekspor.
- CI menjalankan gitleaks terhadap riwayat penuh sebelum langkah lain.

Yang **belum** ada, jadi please consider sebelum dibuka ke publik:

- Tanpa autentikasi pengguna (cukup untuk satu pengguna di mesin sendiri).
- Tanpa HTTPS bawaan — andalkan reverse proxy (`deploy/Caddyfile`).
- `trust proxy` bawaan mati; di balik proxy, setel `TRUST_PROXY` sesuai jumlah hop.
- Koefisien air dan listrik adalah estimasi, bukan pengukuran; jangan dipakai
  sebagai angka resmi.
