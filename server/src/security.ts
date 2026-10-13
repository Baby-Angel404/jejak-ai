import type { RequestHandler } from 'express';

export interface RateLimitOptions {
  /** jumlah permintaan yang boleh dibebani sekaligus */
  capacity: number;
  /** refill per detik */
  refillPerSecond: number;
  now?: () => number;
}

interface Bucket { tokens: number; last: number }

/**
 * Token bucket per kunci (biasanya IP). Dipakai untuk membatasi endpoint yang
 * memakai API key dan perangkat keras milik pengguna: setiap panggilan /api/chat
 * adalah satu prompt sungguhan yang dibayar.
 */
export function createRateLimiter(opts: RateLimitOptions) {
  const now = opts.now ?? (() => Date.now());
  const buckets = new Map<string, Bucket>();

  const take = (key: string, cost = 1): boolean => {
    const t = now();
    const b = buckets.get(key) ?? { tokens: opts.capacity, last: t };
    const elapsed = Math.max(0, (t - b.last) / 1000);
    b.tokens = Math.min(opts.capacity, b.tokens + elapsed * opts.refillPerSecond);
    b.last = t;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      buckets.set(key, b);
      return true;
    }
    buckets.set(key, b);
    return false;
  };

  /** Milidetik sampai satu token tersedia lagi (0 kalau sudah cukup). */
  const retryAfterMs = (key: string): number => {
    const b = buckets.get(key);
    if (!b) return 0;
    const deficit = 1 - b.tokens;
    return deficit <= 0 ? 0 : Math.ceil((deficit / opts.refillPerSecond) * 1000);
  };

  return { take, retryAfterMs };
}

export type Limiter = ReturnType<typeof createRateLimiter>;

/** Middleware 429 + Retry-After. Lewat kalau limiter tidak dikonfigurasi (capacity <= 0). */
export function rateLimit(limiter: Limiter | null): RequestHandler {
  return (req, res, next) => {
    if (!limiter) return next();
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (limiter.take(key)) return next();
    const wait = limiter.retryAfterMs(key);
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(wait / 1000))));
    res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.' });
  };
}

/**
 * Token opsional untuk deployment bersama: kalau AUTH_TOKEN diset, endpoint yang
 * memakai API key atau mengubah koefisien menuntut header `x-jejak-token`.
 * Sengaja tidak dikirim dari browser — token di bundle frontend bukan rahasia lagi.
 */
export function requireToken(token: string | undefined): RequestHandler | null {
  if (!token) return null;
  return (req, res, next) => {
    if (req.get('x-jejak-token') === token) return next();
    res.status(401).json({ error: 'Token tidak valid atau belum dikirim (header x-jejak-token)' });
  };
}