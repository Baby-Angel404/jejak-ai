/**
 * Palet diambil dari CSS variables supaya canvas dan DOM selalu satu warna.
 * Dipanggil ulang tiap tema berubah.
 */
export interface Palette {
  paper: string;
  paper2: string;
  ink: string;
  blue: string;
  yellow: string;
  pink: string;
  /** blend mode untuk lapisan tinta */
  blend: GlobalCompositeOperation;
}

const VARS: Record<keyof Omit<Palette, 'blend'>, string> = {
  paper: '--paper',
  paper2: '--paper2',
  ink: '--ink',
  blue: '--blue',
  yellow: '--yellow',
  pink: '--pink',
};

export function readPalette(dark: boolean): Palette {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as Record<string, string>;
  for (const [k, v] of Object.entries(VARS)) {
    out[k] = cs.getPropertyValue(v).trim() || '#000000';
  }
  return { ...(out as unknown as Palette), blend: dark ? 'screen' : 'multiply' };
}