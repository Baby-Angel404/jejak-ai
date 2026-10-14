import { describe, it, expect } from 'vitest';
import { sessionStore, ratesFrom } from './session';
import { footprint } from '../../../shared/calc';

describe('ratesFrom', () => {
  it('laju byte dan token per detik dari delta metrics', () => {
    expect(ratesFrom({ dIn: 0, dOut: 20, dBytes: 800 }, 0.08)).toEqual({ bytePerS: 10000, tokPerS: 250 });
  });

  it('dt kecil diklem supaya tidak meledak jadi tak hingga', () => {
    expect(ratesFrom({ dIn: 0, dOut: 0, dBytes: 0 }, 0).bytePerS).toBe(0);
  });
});

describe('sessionStore', () => {
  const coef = { e_in: 0.05, e_out: 0.55, pue: 1.2, wue: 1.8 };

  it('metrik yang mundur tidak boleh menurunkan total', () => {
    sessionStore.begin('simulasi lokal', 'simulasi', 'simulasi');
    sessionStore.applyMetrics({
      dIn: 10, dOut: 5, dBytes: 100, dWh: 0, dMl: 0, W: 10, mlPerS: 0.01,
      total: { tokensIn: 10, tokensOut: 5, wh: 0.001, ml: 0.002, bytes: 100 },
    }, 0.08);
    const first = sessionStore.getState();
    expect(first.totals.tokensOut).toBe(5);

    sessionStore.applyMetrics({
      dIn: 0, dOut: 0, dBytes: 0, dWh: 0, dMl: 0, W: 0, mlPerS: 0,
      total: { tokensIn: 3, tokensOut: 2, wh: 0, ml: 0, bytes: 10 },
    }, 0.08);
    expect(sessionStore.getState().totals).toEqual(first.totals);
  });

  it('done menambahkan prompt ke total sesi dan mengisi rentang', () => {
    const fp = footprint(20, 100, coef);
    sessionStore.finish({
      tokensIn: 20, tokensOut: 100, estimated: false,
      bytes: 4096, wh: fp.wh, ml: fp.ml,
      range: { wh: { low: fp.wh * 0.4, mid: fp.wh, high: fp.wh * 3 }, ml: { low: fp.ml * 0.4, mid: fp.ml, high: fp.ml * 3 } },
      provider: 'simulasi lokal', model: 'simulasi', durationMs: 1200,
    });
    const s = sessionStore.getState();
    expect(s.status).toBe('done');
    expect(s.prompts).toBe(1);
    expect(s.sessionTotals.ml).toBeCloseTo(fp.ml, 12);
    expect(s.sessionTotals.bytes).toBe(4096);
    expect(s.instant.W).toBe(0); // setelah selesai, adegan kembali diam
  });

  it('metrics yang terlambat setelah stop diabaikan (adegan harus kembali diam)', () => {
    sessionStore.begin('simulasi lokal', 'simulasi', 'simulasi');
    sessionStore.applyMetrics({
      dIn: 1, dOut: 1, dBytes: 10, dWh: 0, dMl: 0, W: 50, mlPerS: 0.02,
      total: { tokensIn: 2, tokensOut: 2, wh: 0, ml: 0, bytes: 10 },
    }, 0.08);
    sessionStore.stop();

    // Satu tick terakhir bisa tiba setelah tombol Hentikan ditekan.
    sessionStore.applyMetrics({
      dIn: 1, dOut: 1, dBytes: 10, dWh: 0, dMl: 0, W: 116, mlPerS: 0.05,
      total: { tokensIn: 3, tokensOut: 3, wh: 0, ml: 0, bytes: 20 },
    }, 0.08);

    const s = sessionStore.getState();
    expect(s.instant).toEqual({ W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 });
    expect(s.totals.tokensOut).toBe(2);      // total juga tidak boleh naik lagi
    expect(s.status).toBe('idle');
  });

  it('prompt berikutnya menghapus penanda stop', () => {
    sessionStore.stop();
    sessionStore.begin('p', 'm', 'simulasi');
    sessionStore.applyMetrics({
      dIn: 1, dOut: 1, dBytes: 10, dWh: 0, dMl: 0, W: 42, mlPerS: 0.02,
      total: { tokensIn: 1, tokensOut: 1, wh: 0, ml: 0, bytes: 10 },
    }, 0.08);
    expect(sessionStore.getState().instant.W).toBe(42);
  });

  it('stop mengembalikan status idle dan menolokkan laju', () => {
    sessionStore.applyMetrics({
      dIn: 1, dOut: 1, dBytes: 10, dWh: 0, dMl: 0, W: 50, mlPerS: 0.02,
      total: { tokensIn: 2, tokensOut: 2, wh: 0, ml: 0, bytes: 10 },
    }, 0.08);
    sessionStore.stop();
    const s = sessionStore.getState();
    expect(s.status).toBe('idle');
    expect(s.instant).toEqual({ W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 });
  });
});