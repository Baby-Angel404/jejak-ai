import type { HistoryRow, ProviderEntry } from '../../../shared/types';

export type Period = 'day' | 'week' | 'month';

export interface Bucket {
  key: string; label: string;
  prompts: number; tokens: number; ml: number; wh: number; bytes: number;
}

/** Awal hari/minggu/bulan dalam zona waktu lokal, supaya pengelompokan terasa wajar. */
export function bucketKey(ts: number, period: Period): { key: string; label: string } {
  const d = new Date(ts);
  if (period === 'month') {
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }),
    };
  }
  if (period === 'week') {
    const day = (d.getDay() + 6) % 7;                 // Senin sebagai awal minggu
    const start = new Date(d);
    start.setDate(d.getDate() - day);
    return { key: start.toISOString().slice(0, 10), label: start.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }) };
  }
  return {
    key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    label: d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
  };
}

/** Jumlahkan riwayat per periode, urut kronologis. */
export function aggregate(rows: HistoryRow[], period: Period): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of rows) {
    const { key, label } = bucketKey(r.ts, period);
    const b = map.get(key) ?? { key, label, prompts: 0, tokens: 0, ml: 0, wh: 0, bytes: 0 };
    b.prompts += 1;
    b.tokens += r.tokens_in + r.tokens_out;
    b.ml += r.ml;
    b.wh += r.wh;
    b.bytes += r.bytes;
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** Air (mL) untuk 1.000 token keluaran = e_out/1000 * PUE * WUE kWh -> liter -> mL. */
export function waterPer1kOut(p: Pick<ProviderEntry, 'e_out' | 'pue' | 'wue'>): number {
  return (p.e_out / 1000) * p.pue * p.wue * 1000;
}