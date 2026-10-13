import { describe, it, expect } from 'vitest';
import { footprint, withRange, estimateTokens, whToKwh, kwhToLitres, litresToMl, RANGE } from '../src/calc';
import type { Coefficients } from '../../shared/types';

const c: Coefficients = { e_in: 0.05, e_out: 0.55, pue: 1.2, wue: 1.8 };

describe('energi', () => {
  it('energi_Wh = (in/1000*e_in + out/1000*e_out) * PUE', () => {
    const f = footprint(1000, 1000, c);
    expect(f.wh).toBeCloseTo((0.05 + 0.55) * 1.2, 12);
  });

  it('token masuk dan keluar dijumlahkan terpisah', () => {
    expect(footprint(1000, 0, c).wh).toBeCloseTo(0.05 * 1.2, 12);
    expect(footprint(0, 1000, c).wh).toBeCloseTo(0.55 * 1.2, 12);
    expect(footprint(500, 250, c).wh).toBeCloseTo((0.5 * 0.05 + 0.25 * 0.55) * 1.2, 12);
  });

  it('nol token = nol dampak', () => {
    expect(footprint(0, 0, c)).toEqual({ wh: 0, ml: 0 });
  });

  it('energi naik sebanding dengan PUE', () => {
    const a = footprint(1000, 1000, { ...c, pue: 1 });
    const b = footprint(1000, 1000, { ...c, pue: 2 });
    expect(b.wh).toBeCloseTo(a.wh * 2, 12);
  });

  it('orde besaran bawaan masuk akal (0,2-3 Wh dan >0,3 mL per prompt wajar)', () => {
    const f = footprint(800, 400, c);
    expect(f.wh).toBeGreaterThan(0.2);
    expect(f.wh).toBeLessThan(3);
    expect(f.ml).toBeGreaterThan(0.3);
  });
});

describe('air: satuan Wh -> kWh -> liter -> mL', () => {
  it('Wh/1000 = kWh, kWh*WUE = liter, liter*1000 = mL', () => {
    const wh = 0.72;
    const kwh = whToKwh(wh);
    const litres = kwhToLitres(kwh, c.wue);
    const ml = litresToMl(litres);
    expect(kwh).toBeCloseTo(0.00072, 12);
    expect(litres).toBeCloseTo(0.001296, 12);
    expect(ml).toBeCloseTo(1.296, 12);
  });

  it('footprint() konsisten dengan rantai satuan di atas', () => {
    const f = footprint(1000, 1000, c);
    const viaUnits = litresToMl(kwhToLitres(whToKwh(f.wh), c.wue));
    expect(f.ml).toBeCloseTo(viaUnits, 12);
    // Karena 1 Wh * WUE liter/kWh = WUE mL (faktor 1000 saling memotong).
    expect(f.ml).toBeCloseTo(f.wh * c.wue, 12);
  });

  it('1000 token keluar dengan e_out=1 Wh, PUE=1, WUE=2 -> 1 Wh dan 2 mL', () => {
    const f = footprint(0, 1000, { e_in: 0, e_out: 1, pue: 1, wue: 2 });
    expect(f.wh).toBeCloseTo(1, 12);
    // 1 Wh = 0,001 kWh; 0,001 kWh * 2 L/kWh = 0,002 L = 2 mL.
    expect(f.ml).toBeCloseTo(2, 12);
  });
});

describe('kisaran ketidakpastian', () => {
  it('min 0,4x dan maks 3x nilai tengah', () => {
    const r = withRange(10);
    expect(r.low).toBeCloseTo(4);
    expect(r.mid).toBeCloseTo(10);
    expect(r.high).toBeCloseTo(30);
    expect(RANGE.low).toBe(0.4);
    expect(RANGE.high).toBe(3);
  });

  it('selalu ada, bahkan untuk nilai sangat kecil', () => {
    const r = withRange(0.001);
    expect(r.low).toBeCloseTo(0.0004);
    expect(r.high).toBeCloseTo(0.003);
  });
});

describe('tokenizer pendekatan', () => {
  it('sekitar 4 karakter per token, minimal 1 untuk teks tidak kosong', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('x'.repeat(400))).toBe(100);
  });
});