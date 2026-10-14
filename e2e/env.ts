import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Environment E2E:
 * - database riwayat terpisah dari data asli, supaya tes boleh mengisi riwayat
 *   tanpa mengotori `server/data/`;
 * - satu provider (mock) yang menunjuk upstream palsu lokal, supaya jalur "mode
 *   nyata" bisa diuji tanpa API key dan tanpa jaringan.
 */
export const E2E_DATA_DIR = process.env.E2E_DATA_DIR ?? path.join(os.tmpdir(), 'jejak-e2e-data');
export const E2E_COEFFICIENTS_FILE = path.join(here, 'fixtures/coefficients.json');
export const MOCK_PORT = Number(process.env.MOCK_PORT ?? 9999);