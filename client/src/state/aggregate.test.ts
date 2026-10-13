import { describe, it, expect } from 'vitest';
import type { HistoryRow } from '../../../shared/types';
import { aggregate, bucketKey, waterPer1kOut } from './aggregate';

function row(ts: number, over: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: 1, ts, provider: 'p', model: 'm',
    tokens_in: 10, tokens_out: 20, tokens_estimated: 0,
    bytes: 100, wh: 0.01, ml: 0.02, ...over,
  };
}

const day = (y: number, m: number, d: number, hh = 12) => new Date(y, m - 1, d, hh, 0, 0).getTime();

describe('bucketKey', () => {
  it('hari, minggu, dan bulan punya kunci yang berbeda', () => {
    const ts = day(2026, 3, 18);                 // Rabu
    expect(bucketKey(ts, 'day').key).toBe('2026-03-18');
    // Minggu dimulai Senin: Rabu 18 Mar 2026 jatuh di ember yang mulai Senin 16 Mar
    expect(bucketKey(ts, 'week').key.startsWith('2026-03-1')).toBe(true);
    expect(bucketKey(ts, 'month').key).toBe('2026-03');
  });

  it('perprompt di hari yang sama masuk ke satu ember', () => {
    expect(bucketKey(day(2026, 3, 18, 1), 'day').key).toBe(bucketKey(day(2026, 3, 18, 23), 'day').key);
  });
});

describe('aggregate', () => {
  it('menjumlahkan air, listrik, byte, token, dan prompt per hari', () => {
    const buckets = aggregate([
      row(day(2026, 3, 18, 9), { ml: 0.1, wh: 0.05, bytes: 500, tokens_in: 5, tokens_out: 15 }),
      row(day(2026, 3, 18, 15), { ml: 0.3, wh: 0.10, bytes: 700, tokens_in: 5, tokens_out: 25 }),
      row(day(2026, 3, 19, 10), { ml: 0.2, wh: 0.02, bytes: 900, tokens_in: 5, tokens_out: 35 }),
    ], 'day');

    expect(buckets).toHaveLength(2);
    expect(buckets[0].prompts).toBe(2);
    expect(buckets[0].ml).toBeCloseTo(0.4, 12);
    expect(buckets[0].wh).toBeCloseTo(0.15, 12);
    expect(buckets[0].bytes).toBe(1200);
    expect(buckets[0].tokens).toBe(50);
    expect(buckets[1].prompts).toBe(1);
  });

  it('hasilnya urut kronologis dan jumlah ember = jumlah hari unik', () => {
    const buckets = aggregate([row(day(2026, 3, 20)), row(day(2026, 3, 18)), row(day(2026, 3, 19))], 'day');
    expect(buckets.map(b => b.key)).toEqual(['2026-03-18', '2026-03-19', '2026-03-20']);
  });

  it('riwayat kosong tidak menghasilkan ember', () => {
    expect(aggregate([], 'day')).toEqual([]);
    expect(aggregate([], 'month')).toEqual([]);
  });
});

describe('waterPer1kOut', () => {
  it('e_out * PUE * WUE untuk 1.000 token keluar', () => {
    expect(waterPer1kOut({ e_out: 0.55, pue: 1.2, wue: 1.8 })).toBeCloseTo(0.55 * 1.2 * 1.8, 12);
  });

  it('nol e_out berarti nol air', () => {
    expect(waterPer1kOut({ e_out: 0, pue: 2, wue: 3 })).toBe(0);
  });
});