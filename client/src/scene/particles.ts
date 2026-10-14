import { pointAtDistance, type Path } from './paths';

export interface Particle {
  /** jarak sepanjang path, dalam px */
  d: number;
  size: number;
  seed: number;
}

export interface ChannelOpts {
  /** jumlah partikel per detik pada intensitas 1 */
  rate: number;
  /** px per detik pada intensitas 1 */
  speed: number;
  /** ukuran dasar partikel dalam px */
  size: number;
  /** jumlah maksimum partikel yang boleh hidup bersamaan */
  max: number;
}

export interface Channel {
  path: Path;
  particles: Particle[];
  opts: ChannelOpts;
  acc: number;
}

/**
 * Engine partikel generik: semua aliran mengikuti polyline yang sama.
 * Intensitas = spawn rate x kecepatan x panjang path. Tidak ada angka acak:
 * rate dan speed datang dari laju nyata yang sudah dihaluskan.
 */
export function createChannel(path: Path, opts: ChannelOpts): Channel {
  return { path, particles: [], opts, acc: 0 };
}

/** Di bawah intensitas ini aktivitas dianggap selesai. */
export const IDLE_THRESHOLD = 0.02;
/** Pengali kecepatan untuk sisa partikel setelah aktivitas berhenti. */
const IDLE_SPEED_UP = 6;

/**
 * Majukan satu channel. intensity 0 = tidak ada spawn baru dan partikel lama habis.
 *
 * Uap atau paket yang tersisa tidak boleh merayap: tanpa aktivitas baru, adegan
 * harus terasa berhenti dalam ~2 detik. Jadi partikel yang tersisa diberi
 * kecepatan tinggi supaya habis di ujung path.
 */
export function stepChannel(ch: Channel, dt: number, intensity: number, sizeOf?: () => number, speedScale = 1): void {
  const { rate, speed, size, max } = ch.opts;
  if (intensity > IDLE_THRESHOLD && rate > 0) {
    ch.acc += rate * intensity * dt;
    let guard = 0;
    while (ch.acc >= 1 && ch.particles.length < max && guard++ < 40) {
      ch.acc -= 1;
      ch.particles.push({ d: Math.random() * ch.path.length, size: sizeOf ? sizeOf() : size, seed: Math.random() });
    }
    if (ch.acc > 2) ch.acc = 2;
  }

  const idle = intensity <= IDLE_THRESHOLD;
  const v = speed * speedScale * (idle ? IDLE_SPEED_UP : 0.35 + 0.65 * Math.min(1, intensity));
  for (let i = ch.particles.length - 1; i >= 0; i--) {
    const p = ch.particles[i];
    p.d += v * dt;
    if (p.d > ch.path.length) ch.particles.splice(i, 1);
  }
}

export function clearChannel(ch: Channel): void {
  ch.particles.length = 0;
  ch.acc = 0;
}

/** Posisi partikel siap gambar. */
export function place(ch: Channel, p: Particle) {
  return pointAtDistance(ch.path, p.d);
}