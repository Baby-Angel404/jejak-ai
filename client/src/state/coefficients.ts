import type { ProviderEntry } from '../../../shared/types';

/**
 * Fase 1: simulasi lokal memakai satu entri koefisien bawaan di client supaya adegan
 * bisa jalan tanpa server dan tanpa API key. Angkanya ILUSTRASI dengan orde besaran
 * yang masuk akal, sama seperti default di server/config/coefficients.json.
 * Saat server hidup, daftar provider asli diambil dari /api/coefficients.
 */
export const LOCAL_SIMULATION: ProviderEntry = {
  name: 'Simulasi lokal',
  kind: 'openai-compatible',
  baseURL: '',
  keyEnv: '',
  model: 'simulasi-lokal-1',
  e_in: 0.05,
  e_out: 0.55,
  pue: 1.2,
  wue: 1.8,
  sumber: 'ilustrasi (orde besaran; ganti dengan sumber kamu sendiri)',
  tahun: 2025,
  hasKey: true,
};

export async function fetchProviders(signal?: AbortSignal): Promise<Record<string, ProviderEntry>> {
  try {
    const res = await fetch('/api/coefficients', { signal });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, ProviderEntry>;
  } catch {
    return {};
  }
}

export async function fetchHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { signal });
    return res.ok;
  } catch {
    return false;
  }
}