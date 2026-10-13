import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HistoryRow } from '../../../shared/types';

const dir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR ?? path.resolve(dir, '../../data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'history.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  tokens_estimated INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL,
  wh REAL NOT NULL,
  ml REAL NOT NULL
)`);

const ins = db.prepare(`INSERT INTO prompts (ts,provider,model,tokens_in,tokens_out,tokens_estimated,bytes,wh,ml)
  VALUES (@ts,@provider,@model,@tokens_in,@tokens_out,@tokens_estimated,@bytes,@wh,@ml)`);

export function insertRow(r: Omit<HistoryRow, 'id'>): void {
  ins.run(r);
}

export function listRows(q: { from?: number; to?: number; provider?: string }, limit = 500): HistoryRow[] {
  const n = Math.min(Math.max(1, limit), 5000);
  return db.prepare(`SELECT * FROM prompts
    WHERE (@from IS NULL OR ts>=@from) AND (@to IS NULL OR ts<=@to) AND (@provider IS NULL OR provider=@provider)
    ORDER BY ts DESC LIMIT ${n}`)
    .all({ from: q.from ?? null, to: q.to ?? null, provider: q.provider ?? null }) as HistoryRow[];
}

export function sumRows(q: { from?: number; to?: number; provider?: string }) {
  return db.prepare(`SELECT
      COUNT(*) AS prompts,
      COALESCE(SUM(tokens_in),0) AS tokensIn,
      COALESCE(SUM(tokens_out),0) AS tokensOut,
      COALESCE(SUM(bytes),0) AS bytes,
      COALESCE(SUM(wh),0) AS wh,
      COALESCE(SUM(ml),0) AS ml
    FROM prompts
    WHERE (@from IS NULL OR ts>=@from) AND (@to IS NULL OR ts<=@to) AND (@provider IS NULL OR provider=@provider)`)
    .get({ from: q.from ?? null, to: q.to ?? null, provider: q.provider ?? null }) as
    { prompts: number; tokensIn: number; tokensOut: number; bytes: number; wh: number; ml: number };
}