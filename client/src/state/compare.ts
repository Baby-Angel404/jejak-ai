import { useSyncExternalStore } from 'react';
import type { DoneEvent, MetricsEvent, ProviderEntry } from '../../../shared/types';
import { withRange } from '../../../shared/calc';
import type { Instant, Totals } from './session';
import { ratesFrom } from './session';

/** Satu jalur perbandingan: provider yang sama, prompt yang sama. */
export interface CompareLane {
  tag: string;
  name: string;
  model: string;
  status: 'idle' | 'streaming' | 'done' | 'error';
  text: string;
  totals: Totals;
  range: { wh: ReturnType<typeof withRange>; ml: ReturnType<typeof withRange> };
  instant: Instant;
  estimated: boolean;
  error?: string;
}

export interface CompareState {
  lanes: CompareLane[];
  focus: string | null;
  running: boolean;
}

const EMPTY_LANE = (tag: string, name = tag, model = ''): CompareLane => ({
  tag, name, model,
  status: 'idle',
  text: '',
  totals: { tokensIn: 0, tokensOut: 0, bytes: 0, wh: 0, ml: 0 },
  range: { wh: withRange(0), ml: withRange(0) },
  instant: { W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 },
  estimated: true,
});

const hi = (a: number, b: number) => (a > b ? a : b);

class CompareStore {
  private state: CompareState = { lanes: [], focus: null, running: false };
  private listeners = new Set<() => void>();

  getState = (): CompareState => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  private set(patch: Partial<CompareState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
  private patchLane(tag: string, fn: (l: CompareLane) => CompareLane) {
    this.set({ lanes: this.state.lanes.map(l => (l.tag === tag ? fn(l) : l)) });
  }

  begin(items: { tag: string; name: string; model: string }[]) {
    this.set({
      lanes: items.map(i => EMPTY_LANE(i.tag, i.name, i.model)),
      focus: items[0]?.tag ?? null,
      running: true,
    });
  }

  focusLane(tag: string) { this.set({ focus: tag }); }

  appendToken(tag: string, delta: string) {
    this.patchLane(tag, l => ({ ...l, text: l.text + delta }));
  }

  applyMetrics(tag: string, m: MetricsEvent, dtS: number) {
    const r = ratesFrom(m, dtS);
    this.patchLane(tag, l => {
      const t = m.total;
      return {
        ...l,
        totals: {
          tokensIn: hi(l.totals.tokensIn, t.tokensIn),
          tokensOut: hi(l.totals.tokensOut, t.tokensOut),
          bytes: hi(l.totals.bytes, t.bytes),
          wh: hi(l.totals.wh, t.wh),
          ml: hi(l.totals.ml, t.ml),
        },
        instant: { W: m.W, mlPerS: m.mlPerS, bytePerS: r.bytePerS, tokPerS: r.tokPerS },
      };
    });
  }

  finishLane(tag: string, d: DoneEvent) {
    this.patchLane(tag, l => ({
      ...l,
      status: 'done',
      model: d.model || l.model,
      totals: { tokensIn: d.tokensIn, tokensOut: d.tokensOut, bytes: d.bytes, wh: d.wh, ml: d.ml },
      range: d.range,
      instant: { W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 },
      estimated: d.estimated,
    }));
  }

  failLane(tag: string, message: string) {
    this.patchLane(tag, l => ({ ...l, status: 'error', error: message, instant: { W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 } }));
  }

  stopLane(tag: string) {
    this.patchLane(tag, l => (l.status === 'streaming' ? { ...l, status: 'idle', instant: { W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 } } : l));
  }

  stopAll() {
    this.set({ running: false, lanes: this.state.lanes.map(l => this.stopLaneState(l)) });
  }

  private stopLaneState(l: CompareLane): CompareLane {
    return l.status === 'streaming' ? { ...l, status: 'idle', instant: { W: 0, mlPerS: 0, bytePerS: 0, tokPerS: 0 } } : l;
  }

  finish() { this.set({ running: false }); }
}

export const compareStore = new CompareStore();

export function useCompare(): CompareState {
  return useSyncExternalStore(compareStore.subscribe, compareStore.getState, compareStore.getState);
}

/** Kirim prompt yang sama ke 2-3 provider lewat SSE bertag. */
export async function runCompare(opts: {
  prompt: string;
  providers: Record<string, ProviderEntry>;
  ids: string[];
  maxTokens?: number;
  signal: AbortSignal;
}): Promise<void> {
  const res = await fetch('/api/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({ prompt: opts.prompt, providers: opts.ids, maxTokens: opts.maxTokens }),
  });

  if (!res.ok || !res.body) {
    let msg = `Server menolak permintaan (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* abaikan */ }
    for (const id of opts.ids) compareStore.failLane(id, msg);
    compareStore.finish();
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let last = performance.now();

  const handle = (event: string, data: string) => {
    if (data === '[DONE]') return;
    let j: any;
    try { j = JSON.parse(data); } catch { return; }
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    switch (event) {
      case 'compare-start':
        compareStore.begin(j.items);
        break;
      case 'token': compareStore.appendToken(j.tag, j.delta); break;
      case 'metrics': compareStore.applyMetrics(j.tag, j, dt); break;
      case 'done': compareStore.finishLane(j.tag, j); break;
      case 'error': compareStore.failLane(j.tag, j.message); break;
      case 'compare-done': compareStore.finish(); break;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      let event = 'message';
      const payload: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) payload.push(line.slice(5).replace(/^ /, ''));
      }
      if (payload.length) handle(event, payload.join('\n'));
    }
  }
  compareStore.finish();
}