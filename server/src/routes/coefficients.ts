import type { Request, Response } from 'express';
import { loadProviders, saveProviders, resetProviders, validateCoefficients, hasKey, resolveModel } from '../adapters';

/**
 * Express 5 (path-to-regexp v8) menyatakan req.params bisa string ATAU array.
 * Ambil nilai pertama supaya pemanggil route selalu dapat string biasa.
 */
function pertama(v: unknown): string {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === 'string' ? x : '';
}

export function getCoefficientsRoute(_req: Request, res: Response): void {
  const out = Object.fromEntries(
    Object.entries(loadProviders()).map(([id, v]) => [id, {
      ...v,
      // Tampilkan model yang BENAR-BENAR dipakai, bukan nilai mentah dari berkas
      // koefisien (yang bisa berupa "env:CUSTOM_MODEL"). Nilai mentah tetap dikirim
      // sebagai modelRaw supaya tidak ada yang hilang.
      model: resolveModel(id, v),
      modelRaw: v.model,
      hasKey: hasKey(v),
    }]),
  );
  // Catatan: nilai API key tidak pernah ikut. Hanya boolean hasKey.
  res.json(out);
}

export function putCoefficientsRoute(req: Request, res: Response): void {
  const all = loadProviders();
  const id = pertama(req.params.provider);
  const cur = all[id];
  if (!cur) return void res.status(404).json({ error: 'Provider tidak ada' });
  let patch;
  try { patch = validateCoefficients(req.body ?? {}); } catch (e: any) {
    return void res.status(400).json({ error: e.message });
  }
  Object.assign(cur, patch);
  saveProviders(all);
  res.json({ ...cur, model: resolveModel(id, cur), hasKey: hasKey(cur) });
}

export function resetCoefficientsRoute(req: Request, res: Response): void {
  const provider = pertama(req.body?.provider ?? req.query.provider) || undefined;
  try {
    const all = resetProviders(provider);
    const one = provider ? all[provider] : undefined;
    res.json({
      reset: provider ?? 'all',
      coefficients: one ?? all,
      all: Object.fromEntries(Object.entries(all).map(([id, v]) => [id, { ...v, model: resolveModel(id, v), hasKey: hasKey(v) }])),
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
}