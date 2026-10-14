import { test, expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import { E2E_DATA_DIR } from './env';

/**
 * E2E untuk alur yang paling mudah rusak: adegan, struk, navigasi, dan kejujuran
 * label. Semua lewat build produksi yang dilayani Express di satu origin.
 *
 * Mode simulasi lokal dipakai supaya tes tidak bergantung API key maupun jaringan.
 * Mode simulasi sengaja tidak menulis riwayat, jadi bagian dasbor diisi langsung ke
 * database E2E (yang terpisah dari server/data/).
 */

async function kirimPrompt(page: Page, teks = 'Berapa air dan listrik untuk satu prompt?') {
  await page.fill('#prompt', teks);
  await page.getByRole('button', { name: /Kirim prompt/ }).last().click();
}

const struk = (page: Page) => page.locator('.struk');
const canvas = (page: Page) => page.locator('figure.stage canvas');

/**
 * Sidik jari isi kanvas, dibaca langsung dari backing store.
 *
 * Sengaja bukan `locator.screenshot()`: byte PNG hasil encode ulang bisa berbeda
 * walau pikselnya identik, sehingga assertion "diam" jadi tidak stabil.
 * Checksum di dalam halaman ini mengukur isi adegan yang sesungguhnya.
 */
const sidikJariKanvas = (page: Page) => page.evaluate(() => {
  const c = document.querySelector('figure.stage canvas') as HTMLCanvasElement | null;
  if (!c) return 'tidak-ada';
  const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let h = 2166136261;
  for (let i = 0; i < data.length; i += 89) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return `${c.width}x${c.height}:${(h >>> 0).toString(16)}`;
});

/**
 * Tunggu sampai adegan benar-benar diam: dua frame berturut-turut identik.
 * Tutupnya adegan tidak instan karena uap dan elektron masih menyelesaikan perjalanannya.
 */
async function tungguDiam(page: Page, timeoutMs = 15_000) {
  const awal = Date.now();
  let sebelumnya = await sidikJariKanvas(page);
  while (Date.now() - awal < timeoutMs) {
    await page.waitForTimeout(500);
    const sekarang = await sidikJariKanvas(page);
    if (sekarang === sebelumnya) return true;
    sebelumnya = sekarang;
  }
  return false;
}

test.describe('halaman adegan', () => {
  test('Idle: adegan diam total dan struk masih kosong', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Satu prompt, berapa air?');

    // Tunggu font siap dulu: pergantian font mengubah layout, dan layout yang bergeser
    // mengubah lebar kanvas sehingga adegan digambar ulang meski tidak ada aktivitas.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);

    const awal = await sidikJariKanvas(page);
    await page.waitForTimeout(1200);
    expect(await sidikJariKanvas(page), 'adegan harus diam sejak awal').toBe(awal);
    await expect(struk(page)).toContainText('belum ada prompt');
  });

  test('Simulasi lokal: struk terisi, angka estimasi selalu punya rentang', async ({ page }) => {
    await page.goto('/');
    await kirimPrompt(page);

    // Tunggu angka benar-benar naik supaya rentang tidak masih 0.
    await expect(struk(page)).toContainText('Air', { timeout: 20_000 });
    await expect(async () => {
      const teks = await struk(page).innerText();
      const nilai = Number(teks.match(/([\d,]+)\s*mL/)?.[1].replace(',', '.') ?? '0');
      expect(nilai, 'air masih nol').toBeGreaterThan(0);
    }).toPass({ timeout: 25_000 });

    await expect(struk(page)).toContainText('Listrik');
    await expect(struk(page)).toContainText('Data');
    await expect(page.locator('.tag.measured').first()).toBeVisible();

    const ranges = (await page.locator('.struk .range').allInnerTexts()).filter(t => /\d/.test(t));
    expect(ranges.length).toBeGreaterThanOrEqual(2);
    for (const r of ranges) expect(r, `rentang belum lengkap: ${r}`).toMatch(/–/);

    const mL = Number((await struk(page).innerText()).match(/([\d,]+)\s*mL/)?.[1].replace(',', '.') ?? '0');
    const baris = ranges.find(t => t.includes('mL')) ?? '';
    const [low, high] = baris.match(/([\d,]+)/g)?.map(s => Number(s.replace(',', '.'))) ?? [0, 0];
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThanOrEqual(mL);        // min = 0,4 x tengah
    expect(high).toBeGreaterThanOrEqual(mL);    // maks = 3 x tengah
  });

  test('Adegan bergerak saat streaming lalu kembali diam setelah selesai', async ({ page }) => {
    await page.goto('/');
    await kirimPrompt(page);

    const sebelum = await sidikJariKanvas(page);
    await page.waitForTimeout(700);
    expect(await sidikJariKanvas(page), 'adegan harus bergerak saat streaming').not.toBe(sebelum);

    await expect(page.locator('figcaption')).toContainText(/Selesai/, { timeout: 30_000 });
    expect(await tungguDiam(page), 'adegan harus kembali diam setelah selesai').toBe(true);
  });

  test('Tombol hentikan mengembalikan adegan ke diam', async ({ page }) => {
    await page.goto('/');
    await kirimPrompt(page);
    await page.getByRole('button', { name: /Hentikan/ }).click();
    await expect(page.locator('figcaption')).toContainText('Siap');
    expect(await tungguDiam(page)).toBe(true);
  });

  test('Prompt kosong ditolak dengan pesan yang jelas', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Kirim prompt/ }).last().click();
    await expect(page.locator('.error-box')).toContainText(/kosong/i);
  });
});

test.describe('navigasi dan bahasa', () => {
  test('lima halaman terbuka tanpa error dan judulnya benar', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/');
    const halaman: [string, RegExp][] = [
      ['Bandingkan', /Bandingkan provider/],
      ['Dasbor', /Dasbor/],
      ['Koefisien', /Koefisien per provider/],
      ['Metodologi', /Metodologi dan batasan/],
      ['Adegan', /Satu prompt, berapa air\?/],
    ];
    for (const [tombol, judul] of halaman) {
      await page.getByRole('button', { name: tombol, exact: true }).click();
      await expect(page.locator('h1').first()).toHaveText(judul);
    }
    expect(errors).toEqual([]);
  });

  test('tema gelap menggambar ulang kanvas', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Ganti tema/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const frame = await canvas(page).screenshot();
    expect(frame.length).toBeGreaterThan(1000);
  });

  test('beralih ke Inggris lalu kembali ke Indonesia', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.locator('h1')).toHaveText('One prompt, how much water?');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.getByRole('button', { name: /Bahasa Indonesia/ }).click();
    await expect(page.locator('h1')).toHaveText('Satu prompt, berapa air?');
    await expect(page.locator('html')).toHaveAttribute('lang', 'id');
  });

  test('preferensi bahasa dan tema bertahan setelah muat ulang', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'English' }).click();
    await page.getByRole('button', { name: /Switch theme/ }).click();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('responsif dan aksesibilitas', () => {
  test('360 px: tidak ada scroll horizontal di kelima halaman', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/');
    for (const tombol of ['Bandingkan', 'Dasbor', 'Koefisien', 'Metodologi', 'Adegan']) {
      await page.getByRole('button', { name: tombol, exact: true }).click();
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `halaman ${tombol} melebar ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  test('skip link terlihat saat fokus keyboard', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.locator('.skip-link');
    await expect(skip).toBeFocused();
    expect((await skip.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
  });

  test('kanvas punya role img dan aria-label yang berguna', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main#main')).toHaveCount(1);
    await expect(canvas(page)).toHaveAttribute('role', 'img');
    await expect(canvas(page)).toHaveAttribute('aria-label', /Adegan/);
  });
});

test.describe('dasbor dan ekspor', () => {
  test.beforeAll(() => {
    // Mode simulasi sengaja tidak menulis riwayat, jadi tabel diisi langsung ke DB E2E.
    const db = new Database(path.join(E2E_DATA_DIR, 'history.db'));
    db.exec(`CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, provider TEXT NOT NULL,
      model TEXT NOT NULL, tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL,
      tokens_estimated INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL,
      wh REAL NOT NULL, ml REAL NOT NULL)`);
    db.exec('DELETE FROM prompts');
    const ins = db.prepare(`INSERT INTO prompts (ts,provider,model,tokens_in,tokens_out,tokens_estimated,bytes,wh,ml)
      VALUES (@ts,@provider,@model,@tokens_in,@tokens_out,@tokens_estimated,@bytes,@wh,@ml)`);
    const now = Date.now();
    const hari = 24 * 3600 * 1000;
    for (const [i, provider] of ['mock', 'mock-lambat', 'mock'].entries()) {
      ins.run({
        ts: now - i * hari,
        provider,
        model: provider === 'mock' ? 'mock-model-1' : 'mock-model-2',
        tokens_in: 20, tokens_out: 100 + i * 50, tokens_estimated: i === 2 ? 1 : 0,
        bytes: 4000 + i * 500, wh: 0.07 + i * 0.01, ml: 0.12 + i * 0.05,
      });
    }
    db.close();
  });

  test('total, tren, dan tabel riwayat terbaca dari database', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Dasbor', exact: true }).click();

    // Seed: 3 prompt, ml 0,12 + 0,17 + 0,22 = 0,51; wh 0,07 + 0,08 + 0,09 = 0,24;
    // token 3 x 20 masuk + (100 + 150 + 200) keluar = 510; byte 4000 + 4500 + 5000 = 13.500.
    const total = page.locator('.stat-strip');
    await expect(total).toContainText('3');                 // jumlah prompt
    await expect(total).toContainText('510');               // token
    await expect(total).toContainText('0,510 mL');        // format 3 desimal untuk nilai < 1 mL
    await expect(total).toContainText('0,2400 Wh');       // format 4 desimal untuk nilai < 1 Wh
    await expect(total).toContainText('13.500,0 kB');

    await expect(page.locator('table.data caption')).toHaveCount(1);
    await expect(page.locator('table.data tbody tr')).toHaveCount(3);
    await expect(page.locator('table.data tbody tr').first()).toContainText(/mock-model/, { timeout: 10_000 });
    await expect(page.locator('.chart-box .recharts-surface').first()).toBeVisible();
  });

  test('tooltip grafik tren menampilkan angka rapi, bukan mengapung mentah', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Dasbor', exact: true }).click();
    const surface = page.locator('.chart-box .recharts-surface').first();
    await surface.scrollIntoViewIfNeeded();
    await expect(surface).toBeVisible({ timeout: 10_000 });

    // Arahkan kursor ke tengah area plot. Posisi y=0.5 sengaja: di bawah area
    // plot (y~0.9) Recharts memang menyembunyikan tooltip, jadi tes tidak boleh
    const b = (await surface.boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.45, b.y + b.height * 0.5);

    const tip = page.locator('.recharts-tooltip-wrapper .tip');
    await expect(tip).toBeVisible({ timeout: 5_000 });
    const teks = (await tip.innerText()).replace(/\s+/g, ' ').trim();
    expect(teks).toMatch(/mL/);
    expect(teks).toMatch(/Wh/);
    // Angka harus lewat formatter locale, bukan float mentah Recharts.
    expect(teks).not.toMatch(/\d+\.\d{6,}/);
    expect(teks).not.toContain('NaN');
  });

  test('filter provider mempersempit tabel', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Dasbor', exact: true }).click();
    await page.selectOption('#dash-provider', 'mock-lambat');
    await expect(page.locator('table.data tbody tr')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('table.data tbody tr')).toContainText('mock-model-2');
  });

  test('ekspor CSV dan JSON konsisten dengan riwayat', async ({ request }) => {
    const csv = await (await request.get('/api/export.csv')).text();
    const baris = csv.trim().split('\n');
    expect(baris[0]).toBe('ts_iso,provider,model,tokens_in,tokens_out,tokens_estimated,bytes,wh_est,ml_est');
    expect(baris).toHaveLength(4);                          // header + 3 baris
    expect(baris.some(b => b.includes('mock-lambat'))).toBe(true);

    const json = await (await request.get('/api/export.json')).json();
    expect(json.rows).toHaveLength(3);
    expect(json.disclaimer).toMatch(/ESTIMASI/i);
  });

  test('riwayat bisa difilter per rentang waktu di API', async ({ request }) => {
    const kosong = await (await request.get(`/api/history?from=${Date.now() + 60_000}`)).json();
    expect(kosong.rows).toHaveLength(0);
    const semua = await (await request.get('/api/history')).json();
    expect(semua.total.prompts).toBe(3);
  });
});
