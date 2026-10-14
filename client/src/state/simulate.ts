import { footprint, estimateTokens, withRange } from '../../../shared/calc';
import { requestBytes } from '../../../shared/http';
import type { DoneEvent, MetricsEvent, ProviderEntry } from '../../../shared/types';
import { LOCAL_SIMULATION } from './coefficients';
import type { StreamHandlers } from './api';

const TICK_MS = 80;
const enc = new TextEncoder();

/** Delay acak ringan supaya ritmenya terasa seperti streaming, bukan metronom. */
const jitter = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Jawaban lokal yang dirakit dari prompt. Dipisah dari kalkulator supaya mudah diganti
 * pemanggil nyata nanti (mode nyata memakai /api/chat).
 */
function composeAnswer(prompt: string): string {
  const topic = prompt.trim().replace(/\s+/g, ' ').slice(0, 120);
  const head = topic.split(' ').filter(Boolean).slice(0, 8).join(' ') || 'pertanyaanmu';
  return [
    `Ini jawaban simulasi lokal untuk: "${head}".`,
    'Tidak ada provider yang dipanggil. Seluruh teks di layar ini dirakit di perambanmu sendiri, lalu dihitung dengan kalkulator yang sama seperti di server.',
    'Yang bisa diukur di sini ada dua. Token, karena kita menghitung panjang teks yang benar-benar muncul. Byte, karena kita menghitung ukuran persis dari potongan yang dikirim ke peramban.',
    'Yang tidak bisa diukur adalah air dan listrik. Provider tidak membuka konsumsi energi atau pendinginan per prompt, jadi angka itu selalu hasil perkalian koefisien dengan jumlah token.',
    'Koefisien itu sendiri boleh diganti. Nilai bawaan hanya ilustrasi supaya orde besarnya masuk akal, dan setiap angka tetap dibuka dengan rentang 0,4 kali sampai 3 kali nilai tengah.',
    'Kalau angkanya terlihat presisi di layar, itu bukan berarti angka itu presisi di dunia nyata. Presisi tampilan dan kepastian data adalah dua hal berbeda.',
    'Untuk angka yang benar-benar berasal dari provider, jalankan server, isi satu API key di berkas .env, lalu kirim prompt yang sama lewat mode nyata.',
    'Adegan di atas digerakkan oleh laju nyata, bukan angka acak. Elektron bergerak di sepanjang kabel daya dengan kecepatan yang mengikuti daya sesaat, uap mengikuti laju air, dan gelas ukur naik sesuai total air sesi.',
    'Kalau tidak ada aktivitas, adegan benar-benar diam. Preferensi reduced motion dihormati dengan mengurangi jumlah partikel dan kecepatannya, bukan dengan mematikan informasi.',
    'Bagian terpenting dari semua ini adalah keterbatasan. Angka air dan listrik adalah model. Angka token dan byte adalah hasil pengukuran. Halaman metodologi menjelaskan pemisahan itu satu per satu.',
    'Coba kirim prompt lain dan lihat apakah polanya tetap konsisten.',
  ].join(' ');
}

/**
 * Simulasi lokal: tidak ada jaringan, tidak ada API key, tidak ada basis data.
 * Menghasilkan event dengan bentuk yang sama persis dengan /api/chat,
 * sehingga adegan dan struk tidak perlu tahu mana yang sedang berjalan.
 */
export async function simulateChat(
  opts: { prompt: string; signal: AbortSignal },
  h: StreamHandlers,
  coef: ProviderEntry = LOCAL_SIMULATION,
): Promise<void> {
  const answer = composeAnswer(opts.prompt);
  const t0 = performance.now();

  // Byte request: blok header + body yang benar-benar akan dikirim ke provider.
  const headers = { 'Content-Type': 'application/json' };
  const reqBody = JSON.stringify({
    model: coef.model,
    messages: [{ role: 'user', content: opts.prompt }],
    stream: true,
    stream_options: { include_usage: true },
  });
  const reqB = requestBytes('POST', '/chat/completions', headers, reqBody);

  // Token masuk: pendekatan, sama seperti server bila usage tidak dikirim.
  const tokensIn = estimateTokens(opts.prompt);

  let charsOut = 0;
  let respB = 0;
  let last = t0;
  let reportedIn = 0;
  let reportedOut = 0;
  let lastReportedBytes = 0;

  const emit = (force: boolean) => {
    const now = performance.now();
    if (!force && now - last < TICK_MS) return;
    const dt = Math.max(0.02, (now - last) / 1000);
    last = now;

    const tIn = tokensIn;
    const tOut = charsOut ? estimateTokens(answer.slice(0, charsOut)) : 0;
    const dIn = Math.max(0, tIn - reportedIn);
    const dOut = Math.max(0, tOut - reportedOut);
    const dBytes = force ? 0 : respB - lastReportedBytes;
    reportedIn = tIn; reportedOut = tOut; lastReportedBytes = respB;

    const f = footprint(dIn, dOut, coef);
    const m: MetricsEvent = {
      dIn, dOut, dBytes, dWh: f.wh, dMl: f.ml,
      W: (f.wh * 3600) / dt, mlPerS: f.ml / dt,
      total: { tokensIn: reportedIn, tokensOut: reportedOut, ...footprint(reportedIn, reportedOut, coef), bytes: reqB + respB },
    };
    h.onMetrics?.(m, dt);
  };

  const pieces = answer.match(/\S+\s*|\s+/g) ?? [];
  for (const piece of pieces) {
    if (opts.signal.aborted) return;
    await new Promise(r => setTimeout(r, jitter(26, 48)));
    // Dicek lagi setelah tidur: pengguna bisa menekan Hentikan selama jeda ini, dan
    // token/metrik yang terlanjur ditulis akan membuat adegan tetap hidup.
    if (opts.signal.aborted) return;
    charsOut += piece.length;

    // Byte respons: ukuran frame SSE yang benar-benar kita hasilkan.
    const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`;
    respB += enc.encode(frame).byteLength;
    h.onToken?.({ delta: piece });
    emit(false);
  }
  emit(true);

  const bytes = reqB + respB;
  const tokensOut = reportedOut;
  const fp = footprint(tokensIn, tokensOut, coef);
  const done: DoneEvent = {
    tokensIn, tokensOut, estimated: true, bytes,
    wh: fp.wh, ml: fp.ml,
    range: { wh: withRange(fp.wh), ml: withRange(fp.ml) },
    provider: coef.name, model: 'simulasi-lokal',
    durationMs: performance.now() - t0,
  };
  h.onDone?.(done);
}