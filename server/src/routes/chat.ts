import type { Request, Response } from 'express';
import { footprint, estimateTokens, withRange } from '../calc';
import { loadProviders, makeAdapter, resolveModel, type ProviderEntry } from '../adapters';
import { insertRow } from '../db';
import type { ChatMessage, DoneEvent, MetricsEvent } from '../../../shared/types';

/** Event metrics dikirim tiap ~80 ms supaya klien bisa menganimasikan laju, bukan cuma total. */
export const TICK_MS = 80;

export function validMessages(m: unknown): m is ChatMessage[] {
  return Array.isArray(m) && m.length > 0 && m.length <= 100 &&
    m.every(x => x && ['system', 'user', 'assistant'].includes((x as any).role) && typeof (x as any).content === 'string');
}

export function sseHead(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

export type Send = (event: string, data: unknown) => void;

/**
 * Komentar heartbeat untuk SSE. Tanpa ini, proxy di depan (nginx, Cloudflare, ...)
 * bisa memutus koneksi yang tidak membawa data -- padahal stream masih hidup.
 * Komentar `:` dihitung sebagai baris kosong oleh parser SSE, jadi diabaikan klien.
 */
export const HEARTBEAT_MS = 15_000;

export function startHeartbeat(res: Response, ms = HEARTBEAT_MS): () => void {
  const timer = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, ms);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Bungkus event jadi bertag supaya /api/compare bisa melacak provider mana. */
export function taggedSend(send: Send, tag?: string): Send {
  if (!tag) return send;
  return (event, data) => send(event, { tag, ...(data as object) });
}

export interface RunArgs {
  provider: string;
  entry: ProviderEntry;
  messages: ChatMessage[];
  maxTokens?: number;
  signal: AbortSignal;
  send: Send;
  /** apakah dicatat ke riwayat (default ya) */
  persist?: boolean;
}

/**
 * Satu prompt ke satu provider: mengukur token dan byte, menghitung estimasi Wh/mL,
 * lalu mengirim event token | metrics | usage | done. Mengembalikan hasil akhir
 * supaya /api/compare bisa merangkumnya tanpa memanggil provider dua kali.
 */
export async function runStream(a: RunArgs): Promise<DoneEvent> {
  const { provider, entry: p, messages, maxTokens, signal, send } = a;
  const adapter = makeAdapter(provider, p);

  const model = resolveModel(provider, p);
  const promptTokensEstimate = estimateTokens(messages.map(m => m.content).join(''));

  let realIn: number | undefined, realOut: number | undefined;
  let outChars = 0, bytes = 0, reqBytes = 0;
  // Total yang sudah dilaporkan ke klien, supaya delta konsisten dan bisa direkonsiliasi di akhir.
  let rIn = 0, rOut = 0, rBytes = 0;
  let last = Date.now();
  const started = last;

  const emitMetrics = (force = false) => {
    const now = Date.now();
    if (!force && now - last < TICK_MS) return;
    const dt = Math.max(1, now - last) / 1000; last = now;
    const tIn = realIn ?? promptTokensEstimate;
    const tOut = realOut ?? (outChars ? estimateTokens(' '.repeat(outChars)) : 0);
    const dIn = Math.max(0, tIn - rIn), dOut = Math.max(0, tOut - rOut), dBytes = bytes - rBytes;
    const f = footprint(dIn, dOut, p);
    rIn = Math.max(rIn, tIn); rOut = Math.max(rOut, tOut); rBytes = bytes;
    const tot = footprint(rIn, rOut, p);
    const m: MetricsEvent = {
      dIn, dOut, dBytes, dWh: f.wh, dMl: f.ml,
      W: (f.wh * 3600) / dt, mlPerS: f.ml / dt,
      total: { tokensIn: rIn, tokensOut: rOut, wh: tot.wh, ml: tot.ml, bytes: rBytes },
    };
    send('metrics', m);
  };

  for await (const chunk of adapter.send({ messages, signal, maxTokens })) {
    bytes += chunk.bytes;
    if (chunk.reqBytes) reqBytes = Math.max(reqBytes, chunk.reqBytes);
    if (chunk.delta) { outChars += chunk.delta.length; send('token', { delta: chunk.delta }); }
    if (chunk.usage) {
      if (chunk.usage.input_tokens !== undefined) realIn = chunk.usage.input_tokens;
      if (chunk.usage.output_tokens !== undefined) realOut = chunk.usage.output_tokens;
      send('usage', { input_tokens: realIn, output_tokens: realOut });
    }
    emitMetrics();
  }
  emitMetrics(true);

  const estimated = realIn === undefined || realOut === undefined;
  const tokensIn = realIn ?? rIn, tokensOut = realOut ?? rOut;
  const totalBytes = reqBytes + bytes;
  const fp = footprint(tokensIn, tokensOut, p);
  if (a.persist !== false) {
    insertRow({
      ts: Date.now(), provider, model, tokens_in: tokensIn, tokens_out: tokensOut,
      tokens_estimated: estimated ? 1 : 0, bytes: totalBytes, wh: fp.wh, ml: fp.ml,
    });
  }
  return {
    tokensIn, tokensOut, estimated, bytes: totalBytes, wh: fp.wh, ml: fp.ml,
    range: { wh: withRange(fp.wh), ml: withRange(fp.ml) },
    provider, model, durationMs: Date.now() - started,
  };
}

/** POST /api/chat  body: { provider, messages, maxTokens? } -> SSE */
export async function chatRoute(req: Request, res: Response): Promise<void> {
  const { provider, messages, maxTokens } = req.body ?? {};
  let p;
  try {
    p = loadProviders()[provider];
  } catch (e) {
    return void res.status(500).json({ error: `Gagal membaca berkas koefisien: ${(e as Error).message}` });
  }
  if (!p) return void res.status(400).json({ error: `Provider tidak dikenal: ${provider}` });
  if (!validMessages(messages)) return void res.status(400).json({ error: 'messages tidak valid' });

  let ok = true;
  try { makeAdapter(provider, p); } catch (e: any) { ok = false; return void res.status(400).json({ error: e.message }); }
  if (!ok) return;

  sseHead(res);
  const send: Send = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  const stopHeartbeat = startHeartbeat(res);

  try {
    const done = await runStream({ provider, entry: p, messages, maxTokens, signal: ac.signal, send });
    send('done', done);
  } catch (e: any) {
    if (!ac.signal.aborted) send('error', { message: e?.message ?? String(e) });
  } finally {
    stopHeartbeat();
    res.end();
  }
}