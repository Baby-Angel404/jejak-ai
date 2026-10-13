import type { Request, Response } from 'express';
import { listRows, sumRows } from '../db';

function num(v: unknown): number | undefined {
  if (v === undefined || v === '' || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function historyRoute(req: Request, res: Response): void {
  const q = { from: num(req.query.from), to: num(req.query.to), provider: (req.query.provider as string) || undefined };
  const rows = listRows(q, num(req.query.limit) ?? 500);
  res.json({ rows, total: sumRows(q) });
}

const CSV_HEAD = ['ts_iso', 'provider', 'model', 'tokens_in', 'tokens_out', 'tokens_estimated', 'bytes', 'wh_est', 'ml_est'];
const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function exportCsvRoute(_req: Request, res: Response): void {
  const rows = listRows({}, 5000);
  const lines = [CSV_HEAD.join(',')];
  for (const r of rows) {
    lines.push([
      new Date(r.ts).toISOString(), esc(r.provider), esc(r.model),
      r.tokens_in, r.tokens_out, r.tokens_estimated, r.bytes,
      r.wh.toFixed(6), r.ml.toFixed(6),
    ].join(','));
  }
  res.type('text/csv')
    .set('Content-Disposition', 'attachment; filename="jejak-ai.csv"')
    .send(lines.join('\n') + '\n');
}

export function exportJsonRoute(_req: Request, res: Response): void {
  const rows = listRows({}, 5000);
  res.set('Content-Disposition', 'attachment; filename="jejak-ai.json"');
  res.json({
    exportedAt: new Date().toISOString(),
    disclaimer: 'wh dan ml adalah ESTIMASI dari koefisien per provider; tokens dan bytes terukur.',
    rows,
  });
}