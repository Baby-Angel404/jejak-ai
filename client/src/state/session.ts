import { useSyncExternalStore } from 'react';
import type { DoneEvent, MetricsEvent, Range } from '../../../shared/types';

export type Status = 'idle' | 'streaming' | 'done' | 'error';
export type Mode = 'simulasi' | 'live';

export interface Totals { tokensIn: number; tokensOut: number; bytes: number; wh: number; ml: number }

/** Turunan laju sesaat, dipakai untuk menganimasikan adegan. */
export interface Instant { W: number; mlPerS: number; bytePerS: number; tokPerS: number }

export interface SessionState {
  status: Status;
  mode: Mode;
  provider: string;
  model: string;
  text: string;
  totals: Totals;
  sessionTotals: Totals;
  prompts: number;
  tokensEstimated: boolean;
  range: { wh: Range; ml: Range };
  instant: Instant;
  error?: string;
  lastDurationMs?: number;
}

const EMPTY: SessionState = {
  status: 'idle',
  mode: 'simulasi',
  provider: '',
  model: '',
  text: '',
  totals: { tokensIn: 0, tokensOut: 0, bytes: 0, wh: 0, ml: 0 },
  sessionTotals: { tokensIn: 0, tokensOut: 0, bytes: 0, wh: 0, ml: 0 },
  prompts: 0,
  tokensEstimated: true,
  range: { wh: { low: 0, mid: 0, high: 0 }, ml: { low: 0, mid: 0, high: 0 } },
  instant: { W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 },
};

/** Laju turunan dari delta metrics. Semua turunan dihitung di client dari tick yang sama. */
export function ratesFrom(delta: { dIn: number; dOut: number; dBytes: number }, dtS: number): Pick<Instant, 'bytePerS' | 'tokPerS'> {
  const dt = Math.max(0.02, dtS);
  return { bytePerS: delta.dBytes / dt, tokPerS: (delta.dIn + delta.dOut) / dt };
}

type Listener = () => void;

class SessionStore {
  private state: SessionState = EMPTY;
  private listeners = new Set<Listener>();
  /** true setelah stop() sampai prompt berikutnya dimulai. */
  private stopped = false;

  getState = (): SessionState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  setMode(mode: Mode) { this.set({ mode }); }

  begin(provider: string, model: string, mode: Mode) {
    this.stopped = false;
    this.set({
      status: 'streaming', mode, provider, model,
      text: '', error: undefined, tokensEstimated: true,
      totals: { tokensIn: 0, tokensOut: 0, bytes: 0, wh: 0, ml: 0 },
      range: { wh: { low: 0, mid: 0, high: 0 }, ml: { low: 0, mid: 0, high: 0 } },
      instant: { W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 },
    });
  }

  appendToken(delta: string) { this.set({ text: this.state.text + delta }); }

  applyMetrics(m: MetricsEvent, dtS: number) {
    if (this.stopped) return;
    const r = ratesFrom(m, dtS);
    // Total bersifat monoton: sekali naik tidak boleh turun, walau ada tick yang
    // datang tidak berurutan atauhasil hitungan yang berbasis pendekatan.
    const t = m.total;
    const cur = this.state.totals;
    const hi = (a: number, b: number) => (a > b ? a : b);
    const totals: Totals = {
      tokensIn: hi(cur.tokensIn, t.tokensIn),
      tokensOut: hi(cur.tokensOut, t.tokensOut),
      bytes: hi(cur.bytes, t.bytes),
      wh: hi(cur.wh, t.wh),
      ml: hi(cur.ml, t.ml),
    };
    this.set({
      totals,
      instant: { W: m.W, mlPerS: m.mlPerS, bytePerS: r.bytePerS, tokPerS: r.tokPerS },
    });
  }

  finish(d: DoneEvent) {
    const t = { tokensIn: d.tokensIn, tokensOut: d.tokensOut, bytes: d.bytes, wh: d.wh, ml: d.ml };
    const s = this.state.sessionTotals;
    this.set({
      status: 'done',
      provider: d.provider || this.state.provider,
      model: d.model || this.state.model,
      tokensEstimated: d.estimated,
      totals: t,
      range: d.range,
      instant: { W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 },
      prompts: this.state.prompts + 1,
      lastDurationMs: d.durationMs,
      sessionTotals: {
        tokensIn: s.tokensIn + t.tokensIn,
        tokensOut: s.tokensOut + t.tokensOut,
        bytes: s.bytes + t.bytes,
        wh: s.wh + t.wh,
        ml: s.ml + t.ml,
      },
    });
  }

  /**
   * Berhenti di tengah jalan. Setelah ini, metrics yang terlambat (satu tick terakhir
   * yang sudah ada di antrean, atau potongan SSE yang keluar setelah abort) diabaikan:
   * kalau tidak, `instant` terisi lagi oleh nilai non-nol dan adegan tidak pernah diam.
   */
  stop() {
    this.stopped = true;
    this.set({ status: 'idle', instant: { W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 } });
  }

  fail(message: string) {
    this.stopped = true;
    this.set({ status: 'error', error: message, instant: { W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 } }); }

  reset() { this.set({ ...EMPTY, mode: this.state.mode }); }
}

export const sessionStore = new SessionStore();

export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getState, sessionStore.getState);
}