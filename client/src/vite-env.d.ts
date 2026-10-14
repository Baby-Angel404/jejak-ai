/// <reference types="vite/client" />

// TypeScript 7 lebih ketat soal import tanpa deklarasi (error TS2882), jadi
// `import './styles/base.css'` perlu tahu bahwa *.css memang modul yang sah.
// Baris di atas pulls deklarasi bawaan Vite; tanpa itu typecheck gagal.