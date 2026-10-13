import type { DoneEvent, ErrorEvent, MetricsEvent, TokenEvent, UsageEvent } from '../../../shared/types';

export interface StreamHandlers {
  onToken?: (e: TokenEvent) => void;
  onMetrics?: (e: MetricsEvent, dtS: number) => void;
  onUsage?: (e: UsageEvent) => void;
  onDone?: (e: DoneEvent) => void;
  onError?: (e: ErrorEvent) => void;
}

/**
 * SSE lewat POST: EventSource hanya bisa GET, jadi kita baca fetch + ReadableStream.
 * Event: token | metrics | usage | done | error. dtS = jarak since tick sebelumnya.
 */
export async function streamChat(
  opts: { provider: string; prompt: string; maxTokens?: number; signal: AbortSignal },
  h: StreamHandlers,
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      provider: opts.provider,
      maxTokens: opts.maxTokens,
      messages: [{ role: 'user', content: opts.prompt }],
    }),
  });

  if (!res.ok || !res.body) {
    let msg = `Server menolak permintaan (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* abaikan */ }
    h.onError?.({ message: msg });
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let lastTick = performance.now();

  const handle = (event: string, data: string) => {
    if (data === '[DONE]') return;
    let j: any;
    try { j = JSON.parse(data); } catch { return; }
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    switch (event) {
      case 'token': h.onToken?.(j as TokenEvent); break;
      case 'metrics': h.onMetrics?.(j as MetricsEvent, dt); break;
      case 'usage': h.onUsage?.(j as UsageEvent); break;
      case 'done': h.onDone?.(j as DoneEvent); break;
      case 'error': h.onError?.(j as ErrorEvent); break;
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
      const data: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) handle(event, data.join('\n'));
    }
  }
}