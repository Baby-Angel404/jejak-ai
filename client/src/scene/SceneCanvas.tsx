import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildPath } from './paths';
import { createChannel, place, stepChannel, type Channel } from './particles';
import { readPalette, type Palette } from './palette';
import {
  VH, VW, buildGeometry, drawGaugeValue, drawGlassScale, drawLightning, drawNeedle, drawWater, drawWindowLit,
  paintContours, paintLayer, type Layer,
} from './layout';
import type { Instant } from '../state/session';

/** Geser layer tinta supaya salah registrasi kelihatan, dalam koordinat virtual. */
const MISREGISTER: Record<Layer, [number, number]> = { blue: [0, 0], yellow: [2.4, -1.6], pink: [-2.2, 1.4] };

export interface SceneProps {
  instant: Instant;
  sessionMl: number;
  dark: boolean;
  reduced: boolean;
  labels: Record<string, string>;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ema = (cur: number, target: number, dt: number, tau: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

function makeLayer(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  return c;
}

export function SceneCanvas({ instant, sessionMl, dark, reduced, labels }: SceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);
  const geom = useMemo(() => buildGeometry(), []);

  // Rasio intensitas diturunkan dari laju nyata, bukan angka acak.
  const targets = useMemo(() => ({
    power: clamp01(Math.log10(1 + instant.W) / Math.log10(1 + 3)),
    water: clamp01(Math.log10(1 + instant.mlPerS / 0.004) / Math.log10(26)),
    bytes: clamp01(Math.log10(1 + instant.bytePerS) / Math.log10(20001)),
    tokens: clamp01(instant.tokPerS / 150),
  }), [instant.W, instant.mlPerS, instant.bytePerS, instant.tokPerS]);

  // Kanal partikel: dibuat sekali, intensitas berubah tiap frame.
  const channels = useMemo<Channel[]>(() => [
    createChannel(geom.cableToDC, { rate: 22, speed: 150, size: 2.6, max: 40 }),
    createChannel(geom.cableToCool, { rate: 16, speed: 130, size: 2.6, max: 30 }),
    createChannel(geom.laneResponse, { rate: 7, speed: 150, size: 12, max: 28 }),
    createChannel(geom.laneRequest, { rate: 1.8, speed: 110, size: 9, max: 10 }),
    createChannel(buildPath([{ x: 750, y: 178 }, { x: 752, y: 130 }, { x: 747, y: 86 }, { x: 750, y: 44 }]), { rate: 10, speed: 40, size: 10, max: 22 }),
  ], [geom]);
  const [eDC, eCool, pRes, pReq, steam] = channels;

  // Nilai yang berubah tiap tick masuk lewat ref supaya layer cache tidak dibangun ulang.
  const targetsRef = useRef(targets); targetsRef.current = targets;
  const labelsRef = useRef(labels); labelsRef.current = labels;
  const mlRef = useRef(sessionMl); mlRef.current = sessionMl;
  const labelsKey = useMemo(() => Object.values(labels).join('|'), [labels]);
  const instantRef = useRef(instant); instantRef.current = instant;

  useLayoutEffect(() => {
    const el = canvasRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = Math.max(280, Math.floor(entries[0].contentRect.width));
      setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = width / VW;                 // koordinat virtual -> lebar layar
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(VH * scale * dpr);
    canvas.style.height = `${Math.round(VH * scale)}px`;

    // I18nProvider memasang atribut tema di efeknya, dan efek anak jalan lebih dulu.
    // Memasangnya di sini membuat kanvas selalu membaca palet tema yang benar.
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const pal: Palette = readPalette(dark);
    // Di bawah 600 px label kanvas disembunyikan; legenda HTML yang menggantikannya.
    const showLabels = width >= 600;

    // Latar (kertas + tiga tinta + kontur) dikomposit sekali ke satu canvas cache.
    // Per frame hanya satu drawImage latar, bukan empat blend penuh.
    const layers: Record<Layer, HTMLCanvasElement> = { blue: makeLayer(), yellow: makeLayer(), pink: makeLayer() };
    const bg = makeLayer();
    const renderLayer = (target: HTMLCanvasElement, draw: (c: CanvasRenderingContext2D) => void) => {
      target.width = canvas.width; target.height = canvas.height;
      const c = target.getContext('2d');
      if (!c) return;
      c.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      c.clearRect(0, 0, VW, VH);
      draw(c);
    };

    renderLayer(layers.blue, c => paintLayer(c, 'blue', pal, geom));
    renderLayer(layers.yellow, c => paintLayer(c, 'yellow', pal, geom));
    renderLayer(layers.pink, c => paintLayer(c, 'pink', pal, geom));

    bg.width = canvas.width; bg.height = canvas.height;
    const bgCtx = bg.getContext('2d');
    if (bgCtx) {
      bgCtx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
      bgCtx.fillStyle = pal.paper;
      bgCtx.fillRect(0, 0, VW, VH);
      // Tiga tinta, blend multiply/screen, digeser 1-2 px => salah registrasi ala risograf.
      for (const key of ['yellow', 'blue', 'pink'] as Layer[]) {
        const [dx, dy] = MISREGISTER[key];
        bgCtx.save();
        bgCtx.globalCompositeOperation = pal.blend;
        bgCtx.globalAlpha = 0.92;
        bgCtx.drawImage(layers[key], dx, dy, VW, VH);
        bgCtx.restore();
      }
      paintContours(bgCtx, pal, geom, { labels: labelsRef.current, showLabels, clear: false });
    }

    const smooth = { power: 0, water: 0, bytes: 0, tokens: 0 };
    // Daya sesaat dihaluskan supaya angka di dial tidak berkedip mengikuti tick 80 ms.
    let shownW = 0;
    let time = 0;
    let flash = 0;
    let raf = 0;
    let prev = performance.now();
    // Setelah latar dibangun ulang (tema/ukuran/label berubah) kanvas wajib digambar
    // sekali, walau tidak ada aktivitas, supaya tidak menyisakan frame tema lama.
    let forceDraw = true;

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      const k = reduced ? 0.35 : 1;
      const ks = reduced ? 0.6 : 1;

      const tg = targetsRef.current;
      shownW = ema(shownW, instantRef.current.W, dt, 0.6);
      smooth.power = ema(smooth.power, tg.power, dt, 0.28);
      smooth.water = ema(smooth.water, tg.water, dt, 0.35);
      smooth.bytes = ema(smooth.bytes, tg.bytes, dt, 0.2);
      smooth.tokens = ema(smooth.tokens, tg.tokens, dt, 0.25);

      stepChannel(eDC, dt, smooth.power * k, () => 2 + smooth.power * 1.8, ks);
      stepChannel(eCool, dt, smooth.power * k * 0.8, () => 2 + smooth.power * 1.8, ks);
      stepChannel(pRes, dt, smooth.bytes * k, () => packetSize(smooth.bytes), ks);
      stepChannel(pReq, dt, smooth.bytes * k * 0.28, () => packetSize(smooth.bytes) * 0.8, ks);
      stepChannel(steam, dt, smooth.water * k, () => 6 + Math.random() * 8, ks);

      const active = smooth.power + smooth.water + smooth.bytes > 0.004 || channels.some(c => c.particles.length > 0) || flash > 0;
      if (active) time += dt * (reduced ? 0.5 : 1);
      if (!active && !forceDraw) { raf = requestAnimationFrame(draw); return; }
      forceDraw = false;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bg, 0, 0);
      ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);

      // Jendela menyala: makin banyak sesuai aktivitas.
      const lit = Math.min(geom.windows.length, Math.round(smooth.bytes * geom.windows.length * 0.8 + smooth.power * 5));
      drawWindowLit(ctx, pal, geom.windows, lit);

      // Daya sesaat pada meteran.
      drawNeedle(ctx, pal, geom, clamp01(smooth.power * 0.7 + smooth.tokens * 0.3));
      drawGaugeValue(ctx, pal, geom, shownW);

      // Gelas ukur 5 mL.
      const ml = mlRef.current;
      const over = ml > 5;
      drawWater(ctx, pal, geom, ml, time, smooth.water, Math.round(smooth.water * 8 * k));
      drawGlassScale(ctx, pal, geom, ml, width >= 600);
      if (over) {
        ctx.strokeStyle = pal.pink;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          ctx.moveTo(geom.glass.inner.x + 6, geom.glass.inner.y - 8 - i * 9);
          ctx.lineTo(geom.glass.inner.x + geom.glass.inner.w - 6, geom.glass.inner.y - 14 - i * 9);
        }
        ctx.stroke();
      }

      // Elektron di kabel daya: titik kuning, jumlah dan kecepatan ~ daya sesaat.
      ctx.fillStyle = pal.yellow;
      ctx.strokeStyle = pal.ink;
      ctx.lineWidth = 1;
      for (const ch of [eDC, eCool]) {
        for (const p of ch.particles) {
          const q = place(ch, p);
          ctx.beginPath();
          ctx.arc(q.x, q.y, Math.max(1.2, p.size), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }

      // Paket data: kotak seukuran payload, arah mengikuti jalur.
      for (const [ch, alpha] of [[pRes, 0.95], [pReq, 0.7]] as const) {
        ctx.globalAlpha = alpha;
        for (const p of ch.particles) {
          const q = place(ch, p);
          ctx.save();
          ctx.translate(q.x, q.y);
          ctx.rotate(q.angle);
          ctx.fillStyle = pal.blue;
          ctx.fillRect(-p.size / 2, -p.size / 3.2, p.size, p.size / 1.6);
          ctx.strokeStyle = pal.ink;
          ctx.lineWidth = 1.2;
          ctx.strokeRect(-p.size / 2, -p.size / 3.2, p.size, p.size / 1.6);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }

      // Uap: bundar_blob yang menipis saat naik.
      for (const p of steam.particles) {
        const q = place(steam, p);
        const prog = p.d / steam.path.length;
        ctx.globalAlpha = 0.68 * (1 - prog * 0.85);
        ctx.fillStyle = pal.paper2;
        ctx.beginPath();
        ctx.arc(q.x + Math.sin(p.seed * 9 + time * 1.4) * 7, q.y, p.size * (0.5 + prog * 0.55), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.4 * (1 - prog);
        ctx.strokeStyle = pal.blue;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Petir kecil saat daya tinggi.
      if (!reduced && smooth.power > 0.5 && Math.random() < (smooth.power - 0.5) * dt * 3) flash = 0.12;
      if (flash > 0) {
        flash -= dt;
        drawLightning(ctx, pal, Math.random(), clamp01(smooth.power));
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [width, dark, reduced, labelsKey, geom, channels]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={labels.caption ?? ''}
      style={{ display: 'block', width: '100%' }}
    />
  );
}

function packetSize(bytes01: number): number {
  const perPacket = 400 / Math.max(1, bytes01 * 8);
  return Math.min(26, Math.max(7, 6 + Math.log10(1 + perPacket) * 7));
}