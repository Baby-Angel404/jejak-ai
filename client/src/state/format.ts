/** Format angka untuk struk, dasbor, dan perbandingan. Satu sumber supaya konsisten. */

export type Loc = 'id' | 'en';

export function num(lang: Loc, v: number, digits: number): string {
  const s = v.toFixed(digits);
  const [i, d] = s.split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'id' ? '.' : ',');
  return d ? `${grouped},${d}` : grouped;
}

export function fmtMl(lang: Loc, v: number): string {
  if (v === 0) return '0';
  if (v < 0.01) return `${num(lang, v, 4)} mL`;
  if (v < 1) return `${num(lang, v, 3)} mL`;
  return `${num(lang, v, 2)} mL`;
}

export function fmtWh(lang: Loc, v: number): string {
  if (v === 0) return '0';
  if (v < 0.001) return `${num(lang, v, 5)} Wh`;
  return `${num(lang, v, 4)} Wh`;
}

export function fmtBytes(lang: Loc, v: number): string {
  if (v < 1000) return `${num(lang, v, 0)} B`;
  if (v < 1_000_000) return `${num(lang, v, 1)} kB`;
  return `${num(lang, v, 2)} MB`;
}

export function fmtSeconds(lang: Loc, s: number): string {
  const unit = lang === 'id' ? 'dtk' : 's';
  if (s < 1) return `${num(lang, s, 2)} ${unit}`;
  if (s < 60) return `${num(lang, s, 1)} ${unit}`;
  const m = Math.floor(s / 60);
  return lang === 'id'
    ? `${m} mnt ${num(lang, s - m * 60, 0)} dtk`
    : `${m}m ${num(lang, s - m * 60, 0)}s`;
}

export function fmtDateTime(lang: Loc, ts: number): string {
  return new Date(ts).toLocaleString(lang === 'id' ? 'id-ID' : 'en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
/**
 * Recharts 3 memperluas tipe `formatter` Tooltip: nilainya bisa
 * number | string | array, DAN bisa undefined. Formatter lama
 * `(v: number) => [string, string]` tidak lagi valid. Semua grafik memakai
 * helper ini supaya penyesuaian tipe cukup di satu tempat, dan nilai
 * non-number diubah jadi 0 supaya tidak pernah menampilkan "NaN".
 */
export function tooltipFormatter(label: string, render: (n: number) => string) {
  return (v: unknown): [string, string] => {
    const n = typeof v === 'number' ? v : Number(Array.isArray(v) ? v[0] : v);
    return [render(Number.isFinite(n) ? n : 0), label];
  };
}
