import type { Request, Response } from 'express';
import { loadProviders, saveProviders, resetProviders, validateCoefficients, hasKey } from '../adapters';

export function getCoefficientsRoute(_req: Request, res: Response): void {
  const out = Object.fromEntries(
    Object.entries(loadProviders()).map(([k, v]) => [k, { ...v, hasKey: hasKey(v) }]),
  );
  // Catatan: nilai API key tidak pernah ikut. Hanya boolean hasKey.
  res.json(out);
}

export function putCoefficientsRoute(req: Request, res: Response): void {
  const all = loadProviders();
  const cur = all[req.params.provider];
  if (!cur) return void res.status(404).json({ error: 'Provider tidak ada' });
  let patch;
  try { patch = validateCoefficients(req.body ?? {}); } catch (e: any) {
    return void res.status(400).json({ error: e.message });
  }
  Object.assign(cur, patch);
  saveProviders(all);
  res.json({ ...cur, hasKey: hasKey(cur) });
}

export function resetCoefficientsRoute(req: Request, res: Response): void {
  const provider = (req.body?.provider ?? req.query.provider) as string | undefined;
  try {
    const all = resetProviders(provider);
    const one = provider ? all[provider] : undefined;
    res.json({
      reset: provider ?? 'all',
      coefficients: one ?? all,
      all: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, { ...v, hasKey: hasKey(v) }])),
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
}