import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/agent-runs/B6-LOCAL-STUDIO-01/screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test.describe('B6 Local Studio E2E Verification', () => {
  test('responsive layout has zero horizontal overflow across 320/375/768/1024/1440', async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (err) => runtimeErrors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') runtimeErrors.push(`console.error: ${msg.text()}`);
    });

    const viewports = [
      { width: 1440, height: 900, name: 'desktop-1440' },
      { width: 1024, height: 768, name: 'tablet-1024' },
      { width: 768, height: 1024, name: 'tablet-768' },
      { width: 375, height: 812, name: 'mobile-375' },
      { width: 320, height: 700, name: 'mobile-320' },
    ];

    await page.goto('/');
    await expect(page.getByText('B6 Local Studio')).toBeVisible();
    // Wait for initial system doctor + project list fetch so screenshots reflect real loaded data
    await expect(page.getByText(/Source OK/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Đấu Sĩ La Mã Phút Cuối (10s)').first()).toBeVisible({ timeout: 10_000 });

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.card'));
        const maxCardRight = cards.reduce((m, el) => Math.max(m, el.getBoundingClientRect().right), 0);
        const inputs = Array.from(document.querySelectorAll('.input, .select, .textarea'));
        const maxInputRight = inputs.reduce((m, el) => Math.max(m, el.getBoundingClientRect().right), 0);
        return {
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          maxCardRight,
          maxInputRight,
        };
      });
      expect(overflow.scrollWidth, `Horizontal overflow at ${vp.name}`).toBeLessThanOrEqual(overflow.innerWidth);
      expect(overflow.maxCardRight, `Card overflow at ${vp.name}`).toBeLessThanOrEqual(overflow.innerWidth + 1);
      expect(overflow.maxInputRight, `Input overflow at ${vp.name}`).toBeLessThanOrEqual(overflow.innerWidth + 1);
      if (vp.width === 1440 || vp.width === 375) {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${vp.name}-projects.png`), fullPage: false });
      }
    }
    expect(runtimeErrors).toEqual([]);
  });

  test('create project, edit & persist across reload, create Anti asset brief, run real B6 validate job, and cleanup', async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (err) => runtimeErrors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') runtimeErrors.push(`console.error: ${msg.text()}`);
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    // 1. Create a real temporary E2E project
    await page.getByRole('button', { name: /Dự án mới/i }).click();
    const projTitle = `E2E Smoke ${Date.now()}`;
    await page.getByLabel(/Tên dự án/i).fill(projTitle);
    await page.getByLabel(/Tóm tắt ngắn/i).fill('Automated Playwright E2E check');
    await page.getByRole('button', { name: /Khởi tạo dự án B6/i }).click();

    // Wait for Studio view to open (header pill + Narration editor mounted, NOT Projects hint text)
    await expect(page.locator('.header-project-pill')).toContainText('needs_authoring', { timeout: 25_000 });
    await expect(page.getByRole('textbox', { name: 'Lời thoại Narration' })).toBeVisible({ timeout: 25_000 });

    // 2. Edit Title and Narration, verify save & reload persistence
    const updatedTitle = `${projTitle} Edited`;
    const titleInput = page.getByRole('textbox', { name: 'Tên dự án' });
    await titleInput.fill(updatedTitle);
    const narrationInput = page.getByRole('textbox', { name: 'Lời thoại Narration' });
    await narrationInput.fill('Playwright persisted narration check.');

    const patchPromise = page.waitForResponse(
      (res) => res.url().includes('/api/projects/') && res.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: /Lưu \(Ctrl\+S\)/i }).click();
    const patchResponse = await patchPromise;
    expect(patchResponse.status()).toBe(200);
    await expect(page.getByText('Đã lưu')).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: 'Studio' }).click();
    await expect(page.getByRole('textbox', { name: 'Tên dự án' })).toHaveValue(updatedTitle);
    await expect(page.getByRole('textbox', { name: 'Lời thoại Narration' })).toHaveValue('Playwright persisted narration check.');

    // 3. Assets view: prepare Anti image brief (must NOT say Generate completed!)
    await page.getByRole('button', { name: 'Assets' }).click();
    await page.getByLabel('Tên tài nguyên').fill('Test Roman Helmet');
    await page.getByLabel(/Mô tả hình ảnh/i).fill('Hand-painted matte bronze Roman helmet isolated RGBA');
    await page.getByRole('button', { name: /Chuẩn bị yêu cầu ảnh/i }).click();
    await expect(page.getByText(/Đã chuẩn bị \(req-/i)).toBeVisible();
    await expect(page.getByText(/Copy prompt/i)).toBeVisible();

    // 4. Open Roman Gladiator project & inspect Studio + video element + run real B6 Validate + screenshots
    await page.getByRole('button', { name: 'Projects' }).click();
    const romanCard = page.locator('.card', { hasText: 'Đấu Sĩ La Mã Phút Cuối (10s)' });
    await expect(romanCard).toBeVisible();
    await romanCard.getByRole('button', { name: /Mở Studio/i }).click();
    await expect(page.getByText('authored').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440-studio.png'), fullPage: false });

    const videoEl = page.locator('video');
    if ((await videoEl.count()) > 0) {
      await expect(videoEl.first()).toHaveAttribute('src', /preview\.mp4|final\.mp4|draft\.mp4/);
    }

    // Check Character tab gait notice & run Preflight
    await page.getByRole('tab', { name: 'Character' }).click();
    await expect(page.getByText(/Chưa hỗ trợ — cần author gait/i)).toBeVisible();
    await page.getByRole('button', { name: /Chạy Preflight/i }).click();
    await expect(page.getByText(/Hoàn tất preflight/i).first()).toBeVisible({ timeout: 25_000 });

    // Check Export tab & run Validate
    await page.getByRole('tab', { name: 'Export' }).click();
    await page.getByRole('button', { name: /Kiểm tra điều kiện \(Validate\)/i }).click();
    await expect(page.getByText(/Hoàn tất validate/i).first()).toBeVisible({ timeout: 25_000 });

    // Mobile Studio screenshot at 375px
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'mobile-375-studio.png'), fullPage: false });
    const mobOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(mobOverflow).toBe(true);

    // Jobs & QA screenshot at 1440px
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: /Jobs.*QA/i }).click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440-qa.png'), fullPage: false });

    // 5. Cleanup temporary E2E project
    await page.getByRole('button', { name: 'Projects' }).click();
    const tempCard = page.locator('.card', { hasText: updatedTitle });
    await tempCard.getByRole('button', { name: new RegExp(`Xóa ${updatedTitle}`) }).click();
    await tempCard.getByRole('button', { name: /Xác nhận xóa/i }).click();
    await expect(tempCard).toHaveCount(0);
    expect(runtimeErrors).toEqual([]);
  });
});
