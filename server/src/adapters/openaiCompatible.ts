import { Adapter, AdapterConfig, SendArgs, StreamChunk, requestBytes, sseEvents, upstreamError } from './types';

/** Satu adapter untuk OpenAI, Gemini (endpoint /openai), Mistral, DeepSeek, Groq, dan custom (Ollama, vLLM, LM Studio). */
export class OpenAICompatible implements Adapter {
  constructor(private cfg: AdapterConfig) {}

  async *send({ messages, signal, maxTokens }: SendArgs): AsyncGenerator<StreamChunk> {
    const path = '/chat/completions';
    const body = JSON.stringify({
      model: this.cfg.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
    };
    const res = await fetch(`${this.cfg.baseURL.replace(/\/$/, '')}${path}`, {
      method: 'POST', headers, body, signal,
    });
    if (!res.ok) throw await upstreamError(res);
    yield { bytes: 0, reqBytes: requestBytes('POST', path, headers, body) };

    for await (const ev of sseEvents(res)) {
      if (ev.data === '[DONE]' || ev.event === '_tail') { yield { bytes: ev.bytes }; continue; }
      let j: any;
      try { j = JSON.parse(ev.data); } catch { yield { bytes: ev.bytes }; continue; }
      const out: StreamChunk = { bytes: ev.bytes };
      const delta = j.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) out.delta = delta;
      if (j.usage) out.usage = { input_tokens: j.usage.prompt_tokens, output_tokens: j.usage.completion_tokens };
      yield out;
    }
  }
}