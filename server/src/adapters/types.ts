import type { ChatMessage, Usage } from '../../../shared/types';

export type { ChatMessage, Usage };

/** Satu potongan hasil streaming.
 *  bytes    = byte respons upstream yang DIUKUR langsung dari stream.
 *  reqBytes = ukuran request yang DIUKUR dari body + header yang benar-benar dikirim (hanya dipecah sekali, di chunk pertama). */
export interface StreamChunk { delta?: string; usage?: Partial<Usage>; bytes: number; reqBytes?: number }

export interface AdapterConfig { baseURL: string; apiKey: string; model: string }
export interface SendArgs { messages: ChatMessage[]; signal?: AbortSignal; maxTokens?: number }

/** Semua provider mengimplementasikan interface yang sama. */
export interface Adapter { send(args: SendArgs): AsyncGenerator<StreamChunk, void, void> }

export { httpHeaderBytes, requestBytes } from '../../../shared/http';

/** Membaca body SSE dan menghasilkan event; byte dihitung dari chunk mentah. */
export async function* sseEvents(res: Response): AsyncGenerator<{ event: string; data: string; bytes: number }> {
  if (!res.body) throw new Error('Respons upstream tidak punya body');
  const dec = new TextDecoder();
  let buf = '';
  let pendingBytes = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    pendingBytes += chunk.byteLength;
    buf += dec.decode(chunk, { stream: true });
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
      if (data.length) { yield { event, data: data.join('\n'), bytes: pendingBytes }; pendingBytes = 0; }
    }
  }
  if (pendingBytes) yield { event: '_tail', data: '', bytes: pendingBytes };
}

export async function upstreamError(res: Response): Promise<Error> {
  let body = '';
  try { body = (await res.text()).slice(0, 300); } catch { /* abaikan */ }
  return new Error(`Upstream ${res.status}: ${body || res.statusText}`);
}