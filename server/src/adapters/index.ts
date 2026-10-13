import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Adapter } from './types';
import { OpenAICompatible } from './openaiCompatible';
import { AnthropicAdapter } from './anthropic';
import type { ProviderEntry } from '../../../shared/types';

export type { ProviderEntry };

const dir = path.dirname(fileURLToPath(import.meta.url));
/**
 * server/config/coefficients.json. Bisa ditimpa lewat COEF_FILE, dipakai tes
 * untuk memakai berkas koefisien sementara tanpa menyentuh berkas asli.
 */
export const COEF_PATH = process.env.COEFFICIENTS_FILE
  ? path.resolve(process.env.COEFFICIENTS_FILE)
  : path.resolve(dir, '../../config/coefficients.json');
/** Salinan bawaan repositori; tombol "Reset ke default" menyalin ulang file ini. */
export const COEF_DEFAULT_PATH = path.resolve(dir, '../../config/coefficients.default.json');

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadProviders(): Record<string, ProviderEntry> {
  const raw = readJson(COEF_PATH);
  delete raw._catatan;
  return raw as unknown as Record<string, ProviderEntry>;
}

export function loadDefaults(): Record<string, ProviderEntry> {
  const raw = readJson(COEF_DEFAULT_PATH);
  delete raw._catatan;
  return raw as unknown as Record<string, ProviderEntry>;
}

export function saveProviders(p: Record<string, ProviderEntry>): void {
  const raw = readJson(COEF_PATH);
  const catatan = raw._catatan;
  fs.writeFileSync(COEF_PATH, JSON.stringify({ ...(catatan ? { _catatan: catatan } : {}), ...p }, null, 2) + '\n');
}

/** Kembalikan koefisien ke bawaan. Tanpa argumen: semua provider. */
export function resetProviders(provider?: string): Record<string, ProviderEntry> {
  const defaults = loadDefaults();
  if (provider) {
    const cur = loadProviders();
    if (!defaults[provider]) throw new Error(`Provider "${provider}" tidak ada di daftar default`);
    cur[provider] = defaults[provider];
    saveProviders(cur);
    return cur;
  }
  saveProviders(defaults);
  return defaults;
}

export const COEFFICIENT_KEYS = ['e_in', 'e_out', 'pue', 'wue'] as const;
export type CoefficientKey = typeof COEFFICIENT_KEYS[number];

/** Semua koefisien harus angka >= 0 (pue boleh 0 secara numerik, tapi bukan masuk akal; tetap diterima). */
export function validateCoefficients(patch: Record<string, unknown>): Partial<ProviderEntry> {
  const out: Partial<ProviderEntry> = {};
  for (const k of COEFFICIENT_KEYS) {
    if (patch[k] === undefined) continue;
    const v = Number(patch[k]);
    if (!Number.isFinite(v) || v < 0) throw new Error(`${k} harus angka >= 0`);
    out[k] = v;
  }
  if (patch.sumber !== undefined) {
    if (typeof patch.sumber !== 'string') throw new Error('sumber harus teks');
    out.sumber = patch.sumber.slice(0, 300);
  }
  if (patch.tahun !== undefined) {
    const y = Number(patch.tahun);
    if (!Number.isInteger(y) || y < 1990 || y > 2100) throw new Error('tahun harus integer 1990-2100');
    out.tahun = y;
  }
  return out;
}

const fromEnv = (v: string) => (v.startsWith('env:') ? process.env[v.slice(4)] ?? '' : v);

export function resolveModel(id: string, p: ProviderEntry): string {
  return process.env[`${id.toUpperCase()}_MODEL`] || fromEnv(p.model);
}

export function hasKey(p: ProviderEntry): boolean {
  return !!process.env[p.keyEnv];
}

/**
 * Menambah provider baru cukup dengan satu entri di config/coefficients.json
 * (kind: "openai-compatible"), atau satu file adapter baru + satu baris di makeAdapter.
 */
export function makeAdapter(id: string, p: ProviderEntry): Adapter {
  const apiKey = process.env[p.keyEnv] ?? '';
  const baseURL = fromEnv(p.baseURL);
  const model = resolveModel(id, p);
  if (!baseURL) throw new Error(`baseURL untuk "${id}" belum diisi`);
  if (!apiKey && id !== 'custom') throw new Error(`${p.keyEnv} belum diisi di .env`);
  const cfg = { baseURL, apiKey, model };
  return p.kind === 'anthropic' ? new AnthropicAdapter(cfg) : new OpenAICompatible(cfg);
}