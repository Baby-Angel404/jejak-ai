import { Adapter, AdapterConfig, SendArgs, StreamChunk, requestBytes, sseEvents, upstreamError } from './types';

export class AnthropicAdapter implements Adapter {
  constructor(private cfg: AdapterConfig) {}

  async *send({ messages, signal, maxTokens }: SendArgs): AsyncGenerator<StreamChunk> {
    const path = '/messages';
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n') || undefined;
    const body = JSON.stringify({
      model: this.cfg.model,
      max_tokens: maxTokens ?? 1024,
      stream: true,
      ...(system ? { system } : {}),
      messages: messages.filter(m => m.role !== 'system'),
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.cfg.apiKey,
      'anthropic-version': '2023-06-01',
    };
    const res = await fetch(`${this.cfg.baseURL.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers, body, signal,
    });
    if (!res.ok) throw await upstreamError(res);
    yield { bytes: 0, reqBytes: requestBytes('POST', path, headers, body) };

    for await (const ev of sseEvents(res)) {
      const out: StreamChunk = { bytes: ev.bytes };
      let j: any = null;
      try { j = ev.data ? JSON.parse(ev.data) : null; } catch { /* abaikan */ }
      if (j) {
        if (ev.event === 'message_start' && j.message?.usage) out.usage = { input_tokens: j.message.usage.input_tokens };
        else if (ev.event === 'content_block_delta' && j.delta?.type === 'text_delta') out.delta = j.delta.text;
        else if (ev.event === 'message_delta' && j.usage) out.usage = { output_tokens: j.usage.output_tokens };
        else if (ev.event === 'error') throw new Error(`Anthropic: ${j.error?.message ?? 'error'}`);
      }
      yield out;
    }
  }
}