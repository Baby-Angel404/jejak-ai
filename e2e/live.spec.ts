import { test, expect, type Page } from '@playwright/test';

/**
 * Jalur "mode nyata": browser -> Express -> adapter provider -> SSE -> struk.
 *
 * Yang diuji di sini justru inti nilai aplikasi ini: token berasal dari `usage`
 * milik provider (bukan pendekatan), dan byte diukur di server. Provider-nya mock
 * upstream lokal supaya tidak perlu API key sungguhan.
 */

async function keModeLive(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^Kirim prompt$/ }).first().click();
  const pilihProvider = page.locator('#provider');
  await expect(pilihProvider).toBeVisible();
  await expect(pilihProvider.locator('option').first()).toHaveText(/Mock lokal/);
}

test.describe('mode nyata lewat mock provider', () => {
  test('provider dengan key terdaftar muncul di dropdown', async ({ page }) => {
    await keModeLive(page);
    await expect(page.locator('#provider')).toHaveValue('mock');
    // Fixture E2E punya tepat dua provider palsu.
    await expect(page.locator('#provider option')).toHaveCount(2);
  });

  test('prompt dialirkan ke provider dan struk memakai token dari usage', async ({ page }) => {
    await keModeLive(page);
    await page.fill('#prompt', 'Jelaskan pendinginan pusat data.');
    await page.getByRole('button', { name: /^Kirim prompt$/ }).last().click();

    await expect(page.locator('figcaption')).toContainText(/Menghubungi|Selesai/, { timeout: 20_000 });
    // Teks jawaban provider muncul => SSE token benar-benar mengalir ke browser.
    await expect(page.locator('.stream')).toContainText(/Fotosintesis/, { timeout: 20_000 });
    await expect(page.locator('figcaption')).toContainText('Selesai', { timeout: 20_000 });

    const struk = page.locator('.struk');

    // Mock mengirim usage { prompt_tokens: 18, completion_tokens: 42 }.
    // Kalau token diambil dari provider, struk tidak boleh menandai "diperkirakan".
    await expect(struk).toContainText('18 masuk');
    await expect(struk).toContainText('42 keluar');
    await expect(struk).not.toContainText('diperkirakan');

    // Air dan listrik tetap estimasi: token dari provider dikali koefisien E2E
    // (e_in 0,05, e_out 0,55, PUE 1,2, WUE 1,8).
    // Wh = (18/1000 x 0,05 + 42/1000 x 0,55) x 1,2 = 0,0288 Wh; mL = 0,0288 x 1,8 = 0,0518 mL.
    await expect(struk).toContainText('0,0288 Wh');
    await expect(struk).toContainText(/0,05\d mL/);
    await expect(struk).toContainText('estimasi');
  });

  test('prompt masuk ke riwayat dasbor dengan model dan token yang benar', async ({ page }) => {
    await keModeLive(page);
    await page.fill('#prompt', 'Catat jejak prompt ini.');
    await page.getByRole('button', { name: /^Kirim prompt$/ }).last().click();
    await expect(page.locator('.stream')).toContainText(/Fotosintesis/, { timeout: 20_000 });

    await page.getByRole('button', { name: 'Dasbor', exact: true }).click();
    const baris = page.locator('table.data tbody tr').filter({ hasText: 'mock-model-1' });
    await expect(baris.first()).toBeVisible({ timeout: 10_000 });
    await expect(baris.first()).toContainText('mock');
    await expect(baris.first()).toContainText('18');     // token masuk dari usage provider
    await expect(baris.first()).toContainText('42');     // token keluar dari usage provider
  });

  test('byte respons diukur server dan tidak nol', async ({ page }) => {
    await keModeLive(page);
    await page.fill('#prompt', 'Berapa byte yang keluar?');
    await page.getByRole('button', { name: /^Kirim prompt$/ }).last().click();
    await expect(page.locator('.struk')).toContainText('terukur', { timeout: 20_000 });

    // Tunggu byte benar-benar terukur: saat streaming baru dimulai nilainya masih nol.
    await expect(async () => {
      const teks = await page.locator('.struk .row').filter({ hasText: 'Data' }).first().innerText();
      const byte = Number(teks.match(/([\d.,]+)\s*(B|kB|MB)/)?.[1].replace(/\./g, '').replace(',', '.') ?? '0');
      expect(byte, `data terukur harus lebih dari nol: ${teks}`).toBeGreaterThan(0);
    }).toPass({ timeout: 25_000 });
  });
});

test.describe('penolakan yang wajar di mode nyata', () => {
  test('prompt kosong ditolak sebelum memanggil provider', async ({ page }) => {
    await keModeLive(page);
    await page.getByRole('button', { name: /^Kirim prompt$/ }).last().click();
    await expect(page.locator('.error-box')).toContainText(/kosong/i);
  });

  test('provider yang tidak terdaftar ditolak server dengan pesan jelas', async ({ request }) => {
    const res = await request.post('/api/chat', {
      data: { provider: 'tidak-ada', messages: [{ role: 'user', content: 'halo' }] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/tidak dikenal/i);
  });

  test('compare dengan satu provider ditolak (minimal dua)', async ({ request }) => {
    const res = await request.post('/api/compare', {
      data: { prompt: 'halo', providers: ['mock'] },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/2-3/);
  });
});
test.describe('mode Bandingkan lewat mock provider', () => {
  test('dua provider paralel menghasilkan dua jalur dengan jejak berbeda', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Bandingkan', exact: true }).click();

    // Dua provider palsu sudah terpilih secara bawaan; pastikan keduanya aktif.
    await expect(page.getByRole('button', { name: 'Mock lokal' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Mock lambat' })).toHaveAttribute('aria-pressed', 'true');

    await page.fill('#cmp-prompt', 'Bandingkan jejak dua provider.');
    await page.getByRole('button', { name: /Jalankan perbandingan/ }).click();

    const jalur = page.locator('.lane-card');
    await expect(jalur).toHaveCount(2, { timeout: 25_000 });
    await expect(jalur.first()).toContainText('mock-model-1');
    await expect(jalur.nth(1)).toContainText('mock-model-2');

    // Keduanya selesai dan memakai token dari usage provider yang sama (18/42),
    // tapi koefisien berbeda sehingga listrik dan airnya berbeda.
    await expect(jalur.first()).toContainText('0,0288 Wh', { timeout: 25_000 });
    // Provider kedua: (18/1000 x 0,06 + 42/1000 x 0,95) x 1,4 = 0,0574 Wh.
    await expect(jalur.nth(1)).toContainText('0,0574 Wh');
    await expect(page.getByText(/Paling rendah/)).toBeVisible();
  });
});
