import type { Request, Response } from 'express';
import { loadProviders, makeAdapter, resolveModel } from '../adapters';
import { runStream, sseHead, taggedSend, validMessages, type Send } from './chat';
import type { DoneEvent } from '../../../shared/types';

const MIN = 2;
const MAX = 3;

/**
 * POST /api/compare  body: { prompt, providers: string[], maxTokens? }
 *
 * Prompt yang sama dikirim ke 2-3 provider secara paralel. Semua event carries `tag`
 * (id provider) supaya klien bisa memisahkan jalurnya:
 *   compare-start | token | metrics | usage | done | error | compare-done
 */
export async function compareRoute(req: Request, res: Response): Promise<void> {
  const { prompt, providers: ids, maxTokens } = req.body ?? {};

  if (typeof prompt !== 'string' || !prompt.trim()) return void res.status(400).json({ error: 'prompt wajib diisi' });
  if (!Array.isArray(ids) || ids.length < MIN || ids.length > MAX) {
    return void res.status(400).json({ error: `providers harus berisi ${MIN}-${MAX} nama provider` });
  }
  if (!validMessages([{ role: 'user', content: prompt }])) return void res.status(400).json({ error: 'prompt tidak valid' });
  if (new Set(ids as string[]).size !== ids.length) return void res.status(400).json({ error: 'provider tidak boleh dobel' });

  const all = loadProviders();
  const picked: { id: string; entry: (typeof all)[string]; model: string }[] = [];
  for (const id of ids as string[]) {
    const entry = all[id];
    if (!entry) return void res.status(400).json({ error: `Provider tidak dikenal: ${id}` });
    try { makeAdapter(id, entry); } catch (e: any) { return void res.status(400).json({ error: `${id}: ${e.message}` }); }
    picked.push({ id, entry, model: resolveModel(id, entry) });
  }

  sseHead(res);
  const send: Send = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const ac = new AbortController();
  res.on('close', () => ac.abort());

  send('compare-start', { items: picked.map(p => ({ tag: p.id, name: p.entry.name, model: p.model })) });

  const results: { tag: string; done?: DoneEvent; error?: string }[] = [];
  // Semua provider jalan bersamaan: satu lambat tidak menahan yang lain.
  await Promise.all(picked.map(async ({ id, entry, model }) => {
    const lane = taggedSend(send, id);
    try {
      const done = await runStream({
        provider: id, entry, messages: [{ role: 'user', content: prompt }],
        maxTokens, signal: ac.signal, send: lane,
      });
      lane('done', done);
      results.push({ tag: id, done });
    } catch (e: any) {
      const message = ac.signal.aborted ? 'dibatalkan' : (e?.message ?? String(e));
      lane('error', { message });
      results.push({ tag: id, error: message });
    }
  }));

  send('compare-done', { results });
  res.end();
}