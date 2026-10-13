const enc = new TextEncoder();
const byteLen = (s: string) => enc.encode(s).length;

/**
 * Ukuran blok header HTTP yang benar-benar dikirim (request line + header + CRLF penutup).
 * Framing transport (TLS/HTTP2) tidak termasuk, dan tidak diklaim termasuk.
 * Dipakai server (untuk mengukur request ke provider) dan client (untuk simulasi lokal)
 * supaya keduanya menghitung angka yang sama.
 */
export function httpHeaderBytes(method: string, path: string, headers: Record<string, string>): number {
  let n = byteLen(`${method} ${path} HTTP/1.1\r\n`);
  for (const [k, v] of Object.entries(headers)) n += byteLen(`${k}: ${v}\r\n`);
  return n + 2;
}

export function requestBytes(method: string, path: string, headers: Record<string, string>, body: string): number {
  return httpHeaderBytes(method, path, headers) + byteLen(body);
}