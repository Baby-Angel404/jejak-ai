import path from 'node:path';
import os from 'node:os';

/**
 * Environment E2E: database riwayat terpisah dari data asli, supaya tes boleh
 * mengisi riwayat tanpa mengotori `server/data/`.
 */
export const E2E_DATA_DIR = process.env.E2E_DATA_DIR ?? path.join(os.tmpdir(), 'jejak-e2e-data');