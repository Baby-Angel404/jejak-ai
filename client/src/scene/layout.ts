import { buildPath, sag, type Path, type Point } from './paths';
import type { Palette } from './palette';

/** Ruang koordinat virtual adegan; diskalakan ke lebar layar. */
export const VW = 1000;
export const VH = 620;
const GROUND = 468;
const SOIL = 600;

export interface Rect { x: number; y: number; w: number; h: number }

export interface WindowCell extends Rect { order: number }

export interface PylonShape {
  cx: number; top: number;
  arms: Rect[];
  tips: Point[];
  flag: Point[];
  /** Garis kaki menara, dari dasar ke puncak. */
  legA: Point[];
  legB: Point[];
  braces: Point[][];
}

export interface Geometry {
  ground: number;
  soilBottom: number;
  laptop: { screen: Rect; base: Rect };
  pylon: PylonShape;
  cableToDC: Path;
  cableToCool: Path;
  dc: { body: Rect; annex: Rect; parapet: Rect };
  windows: WindowCell[];
  gauge: { cx: number; cy: number; r: number; a0: number; a1: number };
  tower: { left: Point[]; right: Point[]; rim: Point[]; cx: number; topY: number };
  pipe: Path;
  glass: { outer: Rect; inner: Rect; marks: { ml: number; y: number }[] };
  laneResponse: Path;
  laneRequest: Path;
  marks: Point[];
  colorBar: Rect[];
}

function poly(ctx: CanvasRenderingContext2D, pts: Point[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function line(ctx: CanvasRenderingContext2D, pts: Point[], width: number, close = false) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  if (close) ctx.closePath();
  ctx.lineWidth = width;
  ctx.stroke();
}

/** PRNG deterministik supaya urutan jendela menyala dan kilat tidak "berjudi" tiap frame. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildGeometry(): Geometry {
  const arms = [
      { x: 212, y: 176, w: 80, h: 8 },
      { x: 224, y: 212, w: 56, h: 7 },
    ];
  const tips: Point[] = [{ x: 212, y: 180 }, { x: 292, y: 180 }, { x: 226, y: 216 }, { x: 278, y: 216 }];
  const flag: Point[] = [{ x: 252, y: 140 }, { x: 252, y: 116 }, { x: 276, y: 126 }, { x: 252, y: 136 }];
  const pylonLegs: Point[] = [];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    pylonLegs.push({ x: 236 + (252 - 236) * t, y: GROUND + (140 - GROUND) * t });
  }
  const pylonLegs2: Point[] = [];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    pylonLegs2.push({ x: 268 - (268 - 252) * t, y: GROUND + (140 - GROUND) * t });
  }
  const braces: Point[][] = [];
  for (let i = 0; i <= 8; i++) {
    const y0 = GROUND + (140 - GROUND) * (i / 9);
    const y1 = GROUND + (140 - GROUND) * ((i + 1) / 9);
    const half0 = 16 - 8 * (i / 9);
    const half1 = 16 - 8 * ((i + 1) / 9);
    braces.push([{ x: 252 - half0, y: y0 }, { x: 252 + half1, y: y1 }]);
    braces.push([{ x: 252 + half0, y: y0 }, { x: 252 - half1, y: y1 }]);
    braces.push([{ x: 252 - half1, y: y1 }, { x: 252 + half1, y: y1 }]);
  }

  const tower = {
    left: [{ x: 686, y: GROUND }, { x: 702, y: 408 }, { x: 712, y: 350 }, { x: 714, y: 320 }, { x: 710, y: 286 }, { x: 700, y: 236 }, { x: 696, y: 190 }],
    right: [{ x: 814, y: GROUND }, { x: 798, y: 408 }, { x: 788, y: 350 }, { x: 786, y: 320 }, { x: 790, y: 286 }, { x: 800, y: 236 }, { x: 804, y: 190 }],
    rim: [{ x: 696, y: 190 }, { x: 726, y: 180 }, { x: 750, y: 178 }, { x: 774, y: 180 }, { x: 804, y: 190 }],
    cx: 750,
    topY: 178,
  };

  const inner: Rect = { x: 882, y: 358, w: 60, h: 104 };
  const marks = [1, 2, 3, 4, 5].map(ml => ({ ml, y: 462 - (ml / 5) * 96 }));

  const cells: WindowCell[] = [];
  const cols = 8, rows = 4;
  const wx = 484, wy = 288, ww = (652 - 484) / cols, wh = (384 - 288) / rows;
  const rnd = mulberry32(20240613);
  const order = Array.from({ length: cols * rows }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.forEach((idx, rank) => {
    const c = idx % cols, r = Math.floor(idx / cols);
    cells.push({ x: wx + c * ww + 2, y: wy + r * wh + 2, w: ww - 4, h: wh - 4, order: rank });
  });

  return {
    ground: GROUND,
    soilBottom: SOIL,
    laptop: { screen: { x: 58, y: 344, w: 104, h: 68 }, base: { x: 44, y: 412, w: 132, h: 20 } },
    pylon: { cx: 252, top: 140, arms, tips, flag, legA: pylonLegs, legB: pylonLegs2, braces },
    cableToDC: buildPath(sag({ x: 212, y: 180 }, { x: 470, y: 268 }, 46)),
    cableToCool: buildPath([...sag({ x: 212, y: 180 }, { x: 452, y: 212 }, 32), ...sag({ x: 452, y: 212 }, { x: 696, y: 234 }, 38).slice(1)]),
    dc: { body: { x: 468, y: 262, w: 192, h: GROUND - 262 }, annex: { x: 424, y: 322, w: 44, h: GROUND - 322 }, parapet: { x: 476, y: 250, w: 176, h: 12 } },
    windows: cells,
    gauge: { cx: 604, cy: 418, r: 34, a0: Math.PI * 0.78, a1: Math.PI * 2.22 },
    tower,
    pipe: buildPath([{ x: 804, y: 440 }, { x: 830, y: 440 }, { x: 852, y: 424 }, { x: 866, y: 402 }, { x: 878, y: 386 }]),
    glass: { outer: { x: 876, y: 352, w: 72, h: GROUND - 352 }, inner, marks },
    laneResponse: buildPath([{ x: 564, y: GROUND }, { x: 564, y: 506 }, { x: 112, y: 506 }, { x: 112, y: 432 }]),
    laneRequest: buildPath([{ x: 112, y: GROUND }, { x: 112, y: 548 }, { x: 564, y: 548 }, { x: 564, y: GROUND }]),
    marks: [{ x: 20, y: 20 }, { x: 980, y: 20 }, { x: 20, y: 600 }, { x: 980, y: 600 }],
    colorBar: [{ x: 700, y: 30, w: 76, h: 12 }, { x: 782, y: 30, w: 76, h: 12 }, { x: 864, y: 30, w: 76, h: 12 }],
  };
}

export type Layer = 'blue' | 'yellow' | 'pink';

/**
 * Layer tinta datar: hanya isian penuh tanpa garis. Masing-masing digambar ke canvas
 * luar terpisah lalu dikomposit dengan blend multiply/screen dan digeser 1-2 px,
 * supaya salah registrasi terlihat seperti cetakan risograf.
 */
export function paintLayer(ctx: CanvasRenderingContext2D, layer: Layer, pal: Palette, g: Geometry): void {
  ctx.clearRect(0, 0, VW, VH);
  ctx.strokeStyle = ctx.fillStyle = pal[layer];

  if (layer === 'yellow') {
    ctx.globalAlpha = 0.9;
    ctx.fillRect(0, g.ground, VW, g.soilBottom - g.ground);
    ctx.globalAlpha = 1;
    ctx.fillRect(g.dc.body.x + 14, g.dc.body.y + 18, g.dc.body.w - 28, 8);
    ctx.fillRect(g.colorBar[1].x, g.colorBar[1].y, g.colorBar[1].w, g.colorBar[1].h);
  }

  if (layer === 'blue') {
    ctx.globalAlpha = 1;
    // laptop
    ctx.fillRect(g.laptop.base.x, g.laptop.base.y, g.laptop.base.w, g.laptop.base.h);
    ctx.fillRect(g.laptop.screen.x, g.laptop.screen.y, g.laptop.screen.w, g.laptop.screen.h);
    ctx.globalAlpha = 0.55;
    ctx.fillRect(g.laptop.screen.x + 8, g.laptop.screen.y + 8, g.laptop.screen.w - 16, g.laptop.screen.h - 20);
    // menara listrik
    ctx.globalAlpha = 1;
    line(ctx, g.pylon.legA, 7);
    line(ctx, g.pylon.legB, 7);
    for (const b of g.pylon.braces) line(ctx, b, 3);
    for (const a of g.pylon.arms) ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.globalAlpha = 0.85;
    for (const t of g.pylon.tips) { ctx.beginPath(); ctx.arc(t.x, t.y, 5, 0, Math.PI * 2); ctx.fill(); }
    // kabel daya
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    line(ctx, g.cableToDC.pts, 5);
    line(ctx, g.cableToCool.pts, 5);
    // gedung pusat data
    ctx.globalAlpha = 0.9;
    ctx.fillRect(g.dc.body.x, g.dc.body.y, g.dc.body.w, g.dc.body.h);
    ctx.globalAlpha = 0.6;
    ctx.fillRect(g.dc.annex.x, g.dc.annex.y, g.dc.annex.w, g.dc.annex.h);
    // menara pendingin
    ctx.globalAlpha = 0.85;
    poly(ctx, [...g.tower.left, ...[...g.tower.right].reverse()]);
    ctx.fill();
    // pipa
    ctx.globalAlpha = 1;
    line(ctx, g.pipe.pts, 6);
    // gelas
    ctx.globalAlpha = 0.28;
    ctx.fillRect(g.glass.outer.x, g.glass.outer.y, g.glass.outer.w, g.glass.outer.h);
    ctx.globalAlpha = 1;
    // jalur data bawah tanah: bagian dalam diisi warna kertas, paketnya biru
    ctx.lineCap = 'butt';
    ctx.strokeStyle = pal.paper2;
    ctx.globalAlpha = 1;
    line(ctx, g.laneResponse.pts, 15);
    line(ctx, g.laneRequest.pts, 15);
    ctx.strokeStyle = ctx.fillStyle = pal.blue;
    ctx.fillRect(g.colorBar[0].x, g.colorBar[0].y, g.colorBar[0].w, g.colorBar[0].h);
  }

  if (layer === 'pink') {
    ctx.globalAlpha = 0.95;
    ctx.fillRect(g.dc.parapet.x, g.dc.parapet.y, g.dc.parapet.w, g.dc.parapet.h);
    ctx.beginPath();
    poly(ctx, g.pylon.flag);
    ctx.fill();
    for (const a of g.pylon.arms) ctx.fillRect(a.x + a.w - 12, a.y - 2, 12, a.h + 4);
    ctx.beginPath();
    ctx.arc(g.gauge.cx, g.gauge.cy, g.gauge.r - 3, 0, Math.PI * 2);
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 0.75;
    ctx.fillRect(g.colorBar[2].x, g.colorBar[2].y, g.colorBar[2].w, g.colorBar[2].h);
  }
  ctx.globalAlpha = 1;
}

/** Garis kontur tinta gelap + label (label disembunyikan di layar sempit). */
export function paintContours(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  g: Geometry,
  opts: { labels?: Record<string, string>; showLabels?: boolean; clear?: boolean },
): void {
  // clear=false dipakai saat kontur digambar di atas komposit tinta yang sudah jadi.
  if (opts.clear !== false) ctx.clearRect(0, 0, VW, VH);
  ctx.strokeStyle = ctx.fillStyle = pal.ink;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // tanah
  ctx.beginPath(); ctx.moveTo(0, g.ground); ctx.lineTo(VW, g.ground); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, g.soilBottom); ctx.lineTo(VW, g.soilBottom); ctx.stroke();
  ctx.lineWidth = 2.5;

  // laptop
  ctx.strokeRect(g.laptop.base.x, g.laptop.base.y, g.laptop.base.w, g.laptop.base.h);
  ctx.strokeRect(g.laptop.screen.x, g.laptop.screen.y, g.laptop.screen.w, g.laptop.screen.h);
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(g.laptop.base.x + 14, g.laptop.base.y + 10); ctx.lineTo(g.laptop.base.x + g.laptop.base.w - 14, g.laptop.base.y + 10); ctx.stroke();
  ctx.lineWidth = 2.5;

  // menara listrik
  line(ctx, g.pylon.legA, 2.5);
  line(ctx, g.pylon.legB, 2.5);
  for (const b of g.pylon.braces) line(ctx, b, 1.2);
  for (const a of g.pylon.arms) ctx.strokeRect(a.x, a.y, a.w, a.h);
  for (const t of g.pylon.tips) { ctx.beginPath(); ctx.arc(t.x, t.y, 5, 0, Math.PI * 2); ctx.stroke(); }
  poly(ctx, g.pylon.flag); ctx.stroke();

  // kabel
  ctx.lineWidth = 1.8;
  line(ctx, g.cableToDC.pts, 1.8);
  line(ctx, g.cableToCool.pts, 1.8);
  ctx.lineWidth = 2.5;

  // gedung
  ctx.strokeRect(g.dc.body.x, g.dc.body.y, g.dc.body.w, g.dc.body.h);
  ctx.strokeRect(g.dc.annex.x, g.dc.annex.y, g.dc.annex.w, g.dc.annex.h);
  ctx.strokeRect(g.dc.parapet.x, g.dc.parapet.y, g.dc.parapet.w, g.dc.parapet.h);
  ctx.lineWidth = 1.2;
  for (const w of g.windows) ctx.strokeRect(w.x, w.y, w.w, w.h);
  ctx.lineWidth = 2.5;

  // meteran
  const { cx, cy, r, a0, a1 } = g.gauge;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i <= 8; i++) {
    const a = a0 + (a1 - a0) * (i / 8);
    const major = i % 2 === 0;
    const r0 = r - (major ? 13 : 8);
    ctx.lineWidth = major ? 2.2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2));
    ctx.stroke();
  }
  ctx.lineWidth = 2.5;

  // menara pendingin
  poly(ctx, [...g.tower.left, ...[...g.tower.rim], ...[...g.tower.right].reverse()]);
  ctx.stroke();
  ctx.lineWidth = 1.2;
  for (let i = 1; i < g.tower.left.length - 1; i++) {
    const l = g.tower.left[i], r = g.tower.right[i];
    ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.stroke();
  }
  ctx.lineWidth = 2.5;

  // pipa
  line(ctx, g.pipe.pts, 2);

  // gelas + skala (angka skala digambar dinamis supaya bisa mengikuti zoom)
  ctx.strokeRect(g.glass.outer.x, g.glass.outer.y, g.glass.outer.w, g.glass.outer.h);
  ctx.lineWidth = 2.5;

  // jalur data: dua garis casing + arah
  for (const lane of [g.laneResponse, g.laneRequest]) {
    line(ctx, lane.pts, 19);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    line(ctx, lane.pts, 14);
    ctx.restore();
  }
  const arrow = (p: Point, dir: number) => {
    ctx.beginPath();
    ctx.moveTo(p.x + 9 * dir, p.y);
    ctx.lineTo(p.x - 7 * dir, p.y - 8);
    ctx.lineTo(p.x - 7 * dir, p.y + 8);
    ctx.closePath();
    ctx.fill();
  };
  arrow({ x: 300, y: 506 }, -1);
  arrow({ x: 300, y: 548 }, 1);

  // color bar
  ctx.lineWidth = 2;
  for (const r of g.colorBar) ctx.strokeRect(r.x, r.y, r.w, r.h);

  // tanda registrasi
  ctx.lineWidth = 2;
  for (const m of g.marks) {
    ctx.beginPath(); ctx.arc(m.x, m.y, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m.x - 15, m.y); ctx.lineTo(m.x + 15, m.y);
    ctx.moveTo(m.x, m.y - 15); ctx.lineTo(m.x, m.y + 15);
    ctx.stroke();
  }

  // label
  if (opts.showLabels && opts.labels) {
    ctx.fillStyle = pal.ink;
    ctx.font = '600 19px "Instrument Sans", system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    const put = (text: string, x: number, y: number, align: CanvasTextAlign = 'center') => {
      if (!text) return;
      ctx.textAlign = align;
      ctx.lineWidth = 4;
      ctx.strokeStyle = pal.paper2;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    };
    put(opts.labels.you ?? '', 110, 332, 'center');
    put(opts.labels.tower ?? '', 252, 96);
    put(opts.labels.dc ?? '', 564, 224);
    put(opts.labels.cool ?? '', 750, 146);
    put(opts.labels.glass ?? '', 948, 336, 'end');
    ctx.font = '600 15px "Instrument Sans", system-ui, sans-serif';
    put(opts.labels.res ?? '', 726, 512);
    put(opts.labels.req ?? '', 726, 554);
  }
}

export function drawWindowLit(ctx: CanvasRenderingContext2D, pal: Palette, cells: WindowCell[], litCount: number) {
  ctx.fillStyle = pal.pink;
  ctx.globalAlpha = 0.92;
  for (let i = 0; i < Math.min(litCount, cells.length); i++) {
    const w = cells[i];
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }
  ctx.globalAlpha = 1;
}

export function drawNeedle(ctx: CanvasRenderingContext2D, pal: Palette, g: Geometry, t: number) {
  const { cx, cy, r, a0, a1 } = g.gauge;
  const a = a0 + (a1 - a0) * Math.max(0, Math.min(1, t));
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - Math.cos(a) * 7, cy - Math.sin(a) * 7);
  ctx.lineTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8));
  ctx.stroke();
  ctx.fillStyle = pal.pink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * (r - 8) - Math.sin(a) * 3, cy + Math.sin(a) * (r - 8) + Math.cos(a) * 3);
  ctx.lineTo(cx + Math.cos(a) * (r - 8) + Math.sin(a) * 3, cy + Math.sin(a) * (r - 8) - Math.cos(a) * 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = pal.ink;
  ctx.fill();
}

/**
 * Skala gelas. Kalau total air sesi kecil, gelas di-zoom (x10) supaya levelnya
 * kelihatan; faktor zoom ditulis di layar supaya tidak menyesatkan.
 */
export function glassZoom(ml: number): number {
  return ml > 0 && ml < 0.5 ? 10 : 1;
}

/** Tick dan angka skala gelas, digambar tiap frame karena mengikuti zoom. */
export function drawGlassScale(ctx: CanvasRenderingContext2D, pal: Palette, g: Geometry, ml: number, showLabels: boolean) {
  const zoom = glassZoom(ml);
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 1.5;
  for (const m of g.glass.marks) {
    ctx.beginPath();
    ctx.moveTo(g.glass.inner.x, m.y);
    ctx.lineTo(g.glass.inner.x + (zoom > 1 ? 16 : 10), m.y);
    ctx.stroke();
  }
  if (!showLabels) return;

  ctx.fillStyle = pal.ink;
  ctx.font = '600 13px "Instrument Sans", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.lineWidth = 3.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = pal.paper;
  const put = (text: string, x: number, y: number) => {
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  };
  put('0', g.glass.outer.x + g.glass.outer.w + 5, 466);
  for (const m of g.glass.marks) put(String(m.ml / zoom), g.glass.outer.x + g.glass.outer.w + 5, m.y + 4);
  if (zoom > 1) {
    ctx.textAlign = 'center';
    ctx.font = '600 12px "Instrument Sans", system-ui, sans-serif';
    const z = `zoom ${zoom}x`;
    ctx.strokeText(z, g.glass.outer.x + g.glass.outer.w / 2, g.glass.outer.y - 6);
    ctx.fillText(z, g.glass.outer.x + g.glass.outer.w / 2, g.glass.outer.y - 6);
    ctx.textAlign = 'left';
  }
}

/** Angka daya sesaat (W) di dalam dial meteran. */
export function drawGaugeValue(ctx: CanvasRenderingContext2D, pal: Palette, g: Geometry, watts: number) {
  const { cx, cy } = g.gauge;
  const text = `${watts < 10 ? watts.toFixed(2) : watts.toFixed(1)} W`;
  ctx.font = '800 13px "Syne", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = pal.paper2;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy + 13, w, 16, 3);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = pal.ink;
  ctx.fillText(text, cx, cy + 21);
  ctx.textBaseline = 'alphabetic';
}

/** Isi gelas: level = total air sesi (skala 0-5 mL), permukaan bergelombang + gelembung. */
export function drawWater(
  ctx: CanvasRenderingContext2D, pal: Palette, g: Geometry,
  ml: number, time: number, intensity: number, bubbles: number,
) {
  const inner = g.glass.inner;
  const bottom = 462;
  const full = 5;
  const clamped = Math.max(0, Math.min(full, ml * glassZoom(ml)));
  const level = bottom - (clamped / full) * 96;
  if (clamped <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(inner.x, inner.y, inner.w, inner.h);
  ctx.clip();

  ctx.globalAlpha = 0.42;
  ctx.fillStyle = pal.blue;
  ctx.beginPath();
  ctx.moveTo(inner.x, bottom);
  const amp = 1.2 + 3 * intensity;
  for (let x = inner.x; x <= inner.x + inner.w; x += 4) {
    const y = level + Math.sin(x * 0.22 + time * 2.4) * amp * 0.6 + Math.sin(x * 0.51 - time * 1.6) * amp * 0.4;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(inner.x + inner.w, bottom);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = pal.pink;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  for (let x = inner.x; x <= inner.x + inner.w; x += 4) {
    const y = level + Math.sin(x * 0.22 + time * 2.4) * amp * 0.6 + Math.sin(x * 0.51 - time * 1.6) * amp * 0.4;
    if (x === inner.x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // gelembung naik mengikuti laju air
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = pal.paper2;
  for (let i = 0; i < bubbles; i++) {
    const seed = i * 0.618;
    const t = (time * (0.5 + intensity) + seed) % 1;
    const bx = inner.x + 8 + ((seed * 53) % (inner.w - 18));
    const by = bottom - 4 - t * Math.max(4, bottom - level - 6);
    ctx.beginPath();
    ctx.arc(bx, by, 1.6 + (i % 3) * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function drawLightning(ctx: CanvasRenderingContext2D, pal: Palette, seed: number, strength: number) {
  const x0 = 212 + ((seed * 977) % 60);
  const y0 = 176;
  ctx.strokeStyle = pal.pink;
  ctx.lineWidth = 2.6;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  let x = x0, y = y0;
  for (let i = 0; i < 5; i++) {
    x += (((seed * (i + 3) * 37) % 20) - 10);
    y += 16;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 0.25 * strength;
  ctx.strokeStyle = pal.yellow;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.globalAlpha = 1;
}