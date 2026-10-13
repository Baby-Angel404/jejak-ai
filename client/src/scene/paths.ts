export interface Point { x: number; y: number }

export interface Path {
  pts: Point[];
  /** panjang tiap ruas kumulatif */
  cum: number[];
  length: number;
}

/** Bangun path polyline dari titik-titik (koordinat virtual adegan). */
export function buildPath(pts: Point[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return { pts, cum, length: cum[cum.length - 1] };
}

/** Titik pada jarak d (px) sepanjang path, beserta sudut arah gerak. */
export function pointAtDistance(path: Path, d: number): Point & { angle: number } {
  const t = Math.min(Math.max(d, 0), path.length);
  let i = 1;
  while (i < path.cum.length - 1 && path.cum[i] < t) i++;
  const d0 = path.cum[i - 1], d1 = path.cum[i];
  const f = d1 === d0 ? 0 : (t - d0) / (d1 - d0);
  const a = path.pts[i - 1], b = path.pts[i];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** Panek melengkung untuk kabel daya (sag), dipakai sebagai titik-titik path. */
export function sag(a: Point, b: Point, drop: number, steps = 14): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t + Math.sin(Math.PI * t) * drop;
    out.push({ x, y });
  }
  return out;
}
