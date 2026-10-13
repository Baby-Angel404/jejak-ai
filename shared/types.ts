/** Tipe yang dipakai bersama oleh server dan client. Tidak ada kode runtime. */

export type Role = 'system' | 'user' | 'assistant';
export interface ChatMessage { role: Role; content: string }

/** Token yang dilaporkan provider. Kalau tidak ada, angka dihitung pendekatan dan ditandai estimated. */
export interface Usage { input_tokens: number; output_tokens: number }

/** Nilai dengan ketonepastian: min 0,4x, max 3x dari tengah. Air dan listrik SELALU punya range. */
export interface Range { low: number; mid: number; high: number }

export interface Coefficients {
  e_in: number;   // Wh per 1.000 token masuk
  e_out: number;  // Wh per 1.000 token keluar
  pue: number;    // power usage effectiveness
  wue: number;    // liter air per kWh
}

export interface ProviderEntry extends Coefficients {
  name: string;
  kind: 'openai-compatible' | 'anthropic';
  baseURL: string;
  keyEnv: string;
  model: string;
  sumber?: string;
  tahun?: number;
  hasKey?: boolean;   // hanya di respons /api/coefficients, nilai key tidak pernah dikirim
}

/* ---------------------------------------------------------------- SSE */

export interface TokenEvent { delta: string }

/** Terkirim tiap ~80 ms. Semua field adalah DELTA sejak tick sebelumnya, kecuali total dan turunan laju. */
export interface MetricsEvent {
  dIn: number; dOut: number; dBytes: number;
  dWh: number; dMl: number;
  /** Daya sesaat hasil perhitungan: watt. */
  W: number;
  /** Laju air sesaat: mL per detik. */
  mlPerS: number;
  total: { tokensIn: number; tokensOut: number; wh: number; ml: number; bytes: number };
}

export interface UsageEvent { input_tokens?: number; output_tokens?: number }

export interface DoneEvent {
  tokensIn: number; tokensOut: number;
  estimated: boolean;
  bytes: number; wh: number; ml: number;
  range: { wh: Range; ml: Range };
  provider: string; model: string;
  durationMs: number;
}

export interface ErrorEvent { message: string }

/* ------------------------------------------------------------ DB/riwayat */

export interface HistoryRow {
  id: number; ts: number; provider: string; model: string;
  tokens_in: number; tokens_out: number; tokens_estimated: 0 | 1;
  bytes: number; wh: number; ml: number;
}