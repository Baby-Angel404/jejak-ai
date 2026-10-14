import { describe, it, expect } from 'vitest';
import { buildPath, pointAtDistance, sag } from './paths';
import { createChannel, place, stepChannel } from './particles';

const straight = buildPath([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
// Path panjang dipakai untuk tes jumlah partikel: partikel baru muncul di posisi
// acak sepanjang path dan langsung maju pada tick yang sama, jadi path pendek bisa
// membuat partikel langsung keluar di akhir tick.
const longPath = buildPath([{ x: 0, y: 0 }, { x: 100_000, y: 0 }]);

describe('buildPath', () => {
  it('panjang = jumlah ruas', () => {
    expect(straight.length).toBe(100);
    expect(buildPath([{ x: 0, y: 0 }, { x: 3, y: 4 }]).length).toBe(5);
  });

  it('kumulatif ruas tersusun menaik', () => {
    expect(straight.cum).toEqual([0, 100]);
  });
});

describe('pointAtDistance', () => {
  it('awal, tengah, dan ujung tepat', () => {
    expect(pointAtDistance(straight, 0)).toMatchObject({ x: 0, y: 0 });
    expect(pointAtDistance(straight, 50)).toMatchObject({ x: 50, y: 0 });
    expect(pointAtDistance(straight, 100)).toMatchObject({ x: 100, y: 0 });
  });

  it('di luar rentang dijepit ke ujung', () => {
    expect(pointAtDistance(straight, -20).x).toBe(0);
    expect(pointAtDistance(straight, 999).x).toBe(100);
  });

  it('arah mengikuti ruas', () => {
    expect(pointAtDistance(straight, 10).angle).toBeCloseTo(0, 9);
    const down = buildPath([{ x: 0, y: 0 }, { x: 0, y: 10 }]);
    expect(pointAtDistance(down, 5).angle).toBeCloseTo(Math.PI / 2, 9);
  });

  it('berhenti di titik ruas yang benar untuk polyline bersiku', () => {
    const l = buildPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(l.length).toBeCloseTo(20, 9);
    expect(pointAtDistance(l, 10)).toMatchObject({ x: 10, y: 0 });
    expect(pointAtDistance(l, 15)).toMatchObject({ x: 10, y: 5 });
  });
});

describe('sag', () => {
  it('mempertahankan kedua ujung dan melengkungkan di tengah', () => {
    const pts = sag({ x: 0, y: 100 }, { x: 100, y: 100 }, 40, 20);
    expect(pts[0]).toEqual({ x: 0, y: 100 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 100 });
    const mid = pts[Math.floor(pts.length / 2)];
    expect(mid.y).toBeGreaterThan(100);        // turun, seperti kabel yang melendut
    expect(mid.y).toBeLessThanOrEqual(140 + 1e-9);
  });

  it('drop = 0 menghasilkan garis lurus', () => {
    const pts = sag({ x: 0, y: 0 }, { x: 10, y: 0 }, 0, 5);
    expect(pts.every(p => p.y === 0)).toBe(true);
  });
});

describe('partikel', () => {
  const opts = { rate: 10, speed: 100, size: 4, max: 5 };
  const max = opts.max;

  it('intensitas 0 tidak memunculkan partikel baru', () => {
    const ch = createChannel(straight, opts);
    stepChannel(ch, 0.5, 0);
    expect(ch.particles).toHaveLength(0);
  });

  it('jumlah partikel mengikuti laju x waktu x intensitas', () => {
    // Akumulator pecahan: 10 partikel/detik x 0,1 detik = tepat 1 partikel.
    const ch = createChannel(longPath, opts);
    stepChannel(ch, 0.1, 1);
    expect(ch.particles.length).toBe(1);

    // Setengah intensitas: 0,5 per tick, jadi butuh dua tick untuk satu partikel.
    const ch2 = createChannel(longPath, opts);
    stepChannel(ch2, 0.1, 0.5);
    expect(ch2.particles.length).toBe(0);
    stepChannel(ch2, 0.1, 0.5);
    expect(ch2.particles.length).toBe(1);

    stepChannel(ch2, 0.1, 0);
    expect(ch2.particles.length).toBe(1);
  });

  it('batas max: tidak ada partikel baru saat jumlah sudah penuh', () => {
    const ch = createChannel(longPath, opts);
    for (let i = 0; i < max + 10; i++) ch.particles.push({ d: i * 100, size: 4, seed: 0 });
    stepChannel(ch, 0.2, 1);                       // laju penuh, tapi tidak boleh menambah
    expect(ch.particles).toHaveLength(max + 10);

    const ch2 = createChannel(longPath, opts);
    ch2.particles.push({ d: 0, size: 4, seed: 0 });
    stepChannel(ch2, 0.2, 1);
    expect(ch2.particles.length).toBeLessThanOrEqual(max);
  });

  it('partikel hilang setelah melewati ujung path', () => {
    const ch = createChannel(straight, opts);
    ch.particles.push({ d: 10, size: 4, seed: 0 });
    stepChannel(ch, 0.05, 0);
    expect(ch.particles).toHaveLength(1);
    expect(ch.particles[0].d).toBeGreaterThan(10);

    for (let i = 0; i < 20 && ch.particles.length > 0; i++) stepChannel(ch, 0.05, 0);
    expect(ch.particles).toHaveLength(0);
  });

  it('sisa partikel habis dalam waktu singkat setelah aktivitas berhenti', () => {
    // Panjang dan kecepatan mencerminkan geometri adegan sungguhan (jalur data ~450 px, laju ~150 px/s).
    const jalur = buildPath([{ x: 0, y: 0 }, { x: 450, y: 0 }]);
    const ch = createChannel(jalur, { rate: 7, speed: 150, size: 12, max: 30 });
    for (let i = 0; i < 20; i++) ch.particles.push({ d: i * 22, size: 12, seed: 0 });

    let detik = 0;
    while (ch.particles.length > 0 && detik < 3) { stepChannel(ch, 0.1, 0); detik += 0.1; }
    expect(ch.particles, 'partikel sisa harus habis').toHaveLength(0);
    expect(detik, 'adegan harus diam dalam ~2 detik setelah berhenti').toBeLessThan(2);
  });

  it('sizeOf dipakai untuk ukuran partikel, speedScale memperlambat', () => {
    const sized = createChannel(longPath, opts);
    stepChannel(sized, 0.1, 1, () => 9);
    expect(sized.particles[0].size).toBe(9);

    // Partikel baru muncul di posisi acak sepanjang path, jadi untuk mengukur
    // kecepatan kita tanam partikel mulai dari titik yang sama.
    const seed = { d: 0, size: 4, seed: 0 };
    const fast = createChannel(straight, opts);
    fast.particles.push({ ...seed });
    stepChannel(fast, 0.1, 0);
    const slow = createChannel(straight, opts);
    slow.particles.push({ ...seed });
    stepChannel(slow, 0.1, 0, undefined, 0.25);
    expect(place(slow, slow.particles[0]).x).toBeLessThan(place(fast, fast.particles[0]).x);
  });

  it('place selalu mengembalikan titik di atas path', () => {
    const ch = createChannel(straight, opts);
    ch.particles.push({ d: 42, size: 4, seed: 0 });
    const p = place(ch, ch.particles[0]);
    expect(p.x).toBeCloseTo(42, 9);
    expect(p.y).toBe(0);
  });
});