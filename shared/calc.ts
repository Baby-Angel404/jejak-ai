import type { Coefficients, Range } from './types';

export interface Footprint { wh: number; ml: number }

/**
 * energi_Wh = (tokensIn/1000 * e_in + tokensOut/1000 * e_out) * pue
 * air_mL    = energi_Wh * wue
 *
 * Satuan dijaga ketat: Wh / 1000 = kWh; liter * 1000 = mL.
 * Karena 1 Wh = 0,001 kWh dan 1 kWh * WUE liter = WUE * 1000 mL,
 * maka 1 Wh * WUE liter? -> 0,001 * WUE * 1000 mL = WUE mL.
 * Jadi mL = Wh * WUE, tanpa faktor pengali lain.
 *
 * Fungsi ini lives di shared/ supaya kalkulator server dan simulasi lokal
 * client memakai satu implementasi yang sama (satu sumber kebenaran).
 */
export function footprint(tokensIn: number, tokensOut: number, c: Coefficients): Footprint {
  const wh = (tokensIn / 1000 * c.e_in + tokensOut / 1000 * c.e_out) * c.pue;
  return { wh, ml: wh * c.wue };
}

/** Konversi eksplisit, dipakai tes agar satuan tidak pernah hilang diam-diam. */
export function whToKwh(wh: number): number { return wh / 1000 }
export function kwhToLitres(kwh: number, wue: number): number { return kwh * wue }
export function litresToMl(litres: number): number { return litres * 1000 }

/** Provider tidak membuka konsumsi asli per prompt, jadi nilai apa pun selalu tampil bersama rentangnya. */
export const RANGE = { low: 0.4, high: 3 } as const
export function withRange(v: number): Range {
  return { low: v * RANGE.low, mid: v, high: v * RANGE.high }
}

/**
 * Tokenizer pendekatan untuk provider yang tidak mengirim usage.
 * Kasar disengaja: ~4 karakter per token. Hasilnya SELALU ditandai "diperkirakan".
 */
export function estimateTokens(text: string): number {
  return Math.max(text.length ? 1 : 0, Math.ceil(text.length / 4))
}