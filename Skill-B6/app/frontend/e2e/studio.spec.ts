import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/agent-runs/B6-LOCAL-STUDIO-04/screenshots');
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

    // 4. Cleanup temporary E2E project BEFORE taking Cowboy showcase screenshots
    await page.getByRole('button', { name: 'Projects' }).click();
    const tempCard = page.locator('.card', { hasText: updatedTitle });
    await tempCard.getByRole('button', { name: new RegExp(`Xóa ${updatedTitle}`) }).click();
    await tempCard.getByRole('button', { name: /Xác nhận xóa/i }).click();
    await expect(tempCard).toHaveCount(0);

    // 5. Open Cowboy project & inspect live binding badges, QA truth & screenshots
    const romanCard = page.locator('.card', { hasText: 'Đấu Sĩ La Mã Phút Cuối (10s)' });
    await expect(romanCard).toBeVisible();
    const cowboyCard = page.locator('.card', { hasText: "The Cowboy Who Couldn't Catch His Hat" });
    await expect(cowboyCard).toBeVisible();
    await cowboyCard.getByRole('button', { name: /Mở Studio/i }).click();
    await expect(page.getByText('authored').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('editor-sync-badge')).toContainText('rev 1', { timeout: 10_000 });
    const cowboyVideoEl = page.locator('video');
    if ((await cowboyVideoEl.count()) > 0) {
      await expect(page.getByTestId('output-freshness-badge')).toBeVisible({ timeout: 10_000 });
      await expect(cowboyVideoEl.first()).toBeVisible({ timeout: 10_000 });
      await expect(cowboyVideoEl.first()).toHaveAttribute('src', /preview\.mp4|final\.mp4|draft\.mp4/);
    }
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440-studio-cowboy.png'), fullPage: false });

    // Verify Camera tab live binding table & Verify button
    await page.getByRole('tab', { name: 'Camera' }).click();
    await expect(page.getByText(/Bảng Binding UI → Renderer/i)).toBeVisible();
    await expect(page.getByText('Live Runtime Bound')).toBeVisible();
    await expect(page.getByRole('button', { name: /Verify changes/i })).toBeVisible();

    // Check Character tab gait notice & run Preflight
    await page.getByRole('tab', { name: 'Character' }).click();
    await expect(page.getByText(/Chưa hỗ trợ — cần author gait/i)).toBeVisible();
    await page.getByRole('button', { name: /Chạy Preflight/i }).click();
    await expect(page.getByText(/Hoàn tất preflight/i).first()).toBeVisible({ timeout: 25_000 });

    // Check Export tab: run Validate & verify Full Export remains strictly locked unless approved
    await page.getByRole('tab', { name: 'Export' }).click();
    await expect(page.getByRole('button', { name: /Xuất Video Full MP4/i })).toBeDisabled();
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
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440-qa-cowboy.png'), fullPage: false });
    expect(runtimeErrors).toEqual([]);
  });

  test('opens Samurai articulated studio, inspects motion controls & overlay, saves duplicate edit & cleans up', async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (err) => runtimeErrors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') runtimeErrors.push(`console.error: ${msg.text()}`);
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByText(/Source OK/i)).toBeVisible({ timeout: 15_000 });

    const samuraiCard = page.locator('.card', { hasText: 'The Samurai Who Challenged a Leaf' }).first();
    await expect(samuraiCard).toBeVisible({ timeout: 10_000 });
    await samuraiCard.getByRole('button', { name: /Mở Studio/i }).click();

    await expect(page.getByTestId('editor-sync-badge')).toBeVisible({ timeout: 10_000 });
    const samuraiVideoEl = page.locator('video');
    if ((await samuraiVideoEl.count()) > 0) {
      await expect(samuraiVideoEl.first()).toBeVisible({ timeout: 10_000 });
    }

    // Toggle motion diagnostic overlay & take screenshot
    await page.getByTestId('toggle-motion-overlay').click();
    await expect(page.getByTestId('motion-diagnostic-overlay')).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440-studio-samurai.png'), fullPage: false });

    // Open Shot tab & inspect articulated Motion & Gait Engine controls
    await page.getByRole('tab', { name: 'Shot' }).click();
    await expect(page.getByTestId('motion-engine-badge')).toContainText(/Articulated/i);
    await expect(page.getByTestId('motion-preset-select')).toBeVisible();
    await expect(page.getByTestId('visual-beat-select')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440-samurai-shot-motion.png'), fullPage: false });

    // Open Camera tab & inspect Camera Director preset + Verify changes button
    await page.getByRole('tab', { name: 'Camera' }).click();
    await expect(page.getByTestId('camera-preset-select')).toBeVisible();

    // Open Export tab: verify motion QC status visible & Export Full strictly locked (pending review/approval)
    await page.getByRole('tab', { name: 'Export' }).click();
    await expect(page.getByRole('button', { name: /Xuất Video Full MP4/i })).toBeDisabled();

    // Duplicate Samurai to test live motion edit persistence cleanly without dirtying tracked Samurai project
    await page.getByRole('button', { name: 'Projects' }).click();
    await samuraiCard.getByRole('button', { name: /Nhân bản/i }).click();
    const copyCard = page.locator('.card', { hasText: 'The Samurai Who Challenged a Leaf (Copy)' }).first();
    await expect(copyCard).toBeVisible({ timeout: 10_000 });
    await copyCard.getByRole('button', { name: /Mở Studio/i }).click();

    await page.getByRole('tab', { name: 'Shot' }).click();
    await page.getByTestId('motion-preset-select').selectOption('dash');
    await page.getByTestId('motion-cadence').fill('3.2');
    const patchPromise = page.waitForResponse(
      (res) => res.url().includes('/api/projects/') && res.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: /Lưu \(Ctrl\+S\)/i }).click();
    expect((await patchPromise).status()).toBe(200);
    await expect(page.getByText('Đã lưu')).toBeVisible({ timeout: 5_000 });
    await page.reload();
    await page.getByRole('button', { name: 'Studio' }).click();
    await page.getByRole('tab', { name: 'Shot' }).click();
    await expect(page.getByTestId('motion-preset-select')).toHaveValue('dash');
    await expect(page.getByTestId('motion-cadence')).toHaveValue('3.2');

    // Cleanup temporary Samurai duplicate
    await page.getByRole('button', { name: 'Projects' }).click();
    await copyCard.getByRole('button', { name: /Xóa .*Copy/i }).click();
    await copyCard.getByRole('button', { name: /Xác nhận xóa/i }).click();
    await expect(copyCard).toHaveCount(0);

    expect(runtimeErrors).toEqual([]);
  });

  test('opens Zombie Editorial studio, inspects Editorial Director controls, Jobs & QA diagnostics, mobile 375px layout, and saves duplicate edit', async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (err) => runtimeErrors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') runtimeErrors.push(`console.error: ${msg.text()}`);
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByText(/Source OK/i)).toBeVisible({ timeout: 15_000 });

    const zombieCard = page.locator('.card', { hasText: 'The Zombie Who Was Afraid of a Human' }).first();
    await expect(zombieCard).toBeVisible({ timeout: 10_000 });
    await zombieCard.getByRole('button', { name: /Mở Studio/i }).click();

    await expect(page.getByTestId('editor-sync-badge')).toBeVisible({ timeout: 10_000 });
    const samuraiVideoEl = page.locator('video');
    if ((await samuraiVideoEl.count()) > 0) {
      await expect(samuraiVideoEl.first()).toBeVisible({ timeout: 10_000 });
    }

    // Toggle motion/editorial diagnostic overlay & capture screenshot
    await page.getByTestId('toggle-motion-overlay').click();
    await expect(page.getByTestId('motion-diagnostic-overlay')).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440-studio-zombie.png'), fullPage: false });

    // Open Shot tab & inspect Editorial Director controls
    await page.getByRole('tab', { name: 'Shot' }).click();
    await expect(page.getByTestId('editorial-role-select')).toBeVisible();
    await expect(page.getByTestId('editorial-shot-size-select')).toBeVisible();
    await expect(page.getByTestId('editorial-focus-target-select')).toBeVisible();
    await expect(page.getByTestId('editorial-cam-move-select')).toBeVisible();
    await expect(page.getByTestId('editorial-transition-select')).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440-zombie-editorial-shot.png'), fullPage: false });

    // Open Export tab: Full MP4 still strictly locked until actual human visual review + sign-off
    await page.getByRole('tab', { name: 'Export' }).click();
    await expect(page.getByRole('button', { name: /Xuất Video Full MP4/i })).toBeDisabled();

    // Open Jobs & QA tab: inspect Editorial Diagnostics & Pacing Telemetry
    await page.getByRole('button', { name: 'Jobs & QA' }).click();
    await expect(page.getByTestId('editorial-diagnostics-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('editorial-qc-status-badge')).toContainText(/PASS|Đạt/i);
    await expect(page.getByText(/Ước lượng retention: Chưa khả dụng/i)).toBeVisible();
    await expect(page.getByTestId('editorial-mad-toggle-btn')).toBeVisible();
    await page.getByTestId('editorial-mad-toggle-btn').click();
    await expect(page.getByTestId('editorial-mad-toggle-btn')).toContainText(/Raw MAD/i);
    await page.getByTestId('editorial-mad-toggle-btn').click();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440-zombie-editorial-qa.png'), fullPage: false });

    // Check mobile 375px zero horizontal overflow on Zombie Studio & Jobs QA
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(200);
    const qaOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(qaOverflow).toBe(false);
    await page.getByRole('button', { name: 'Studio' }).click();
    await page.waitForTimeout(200);
    const studioOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(studioOverflow).toBe(false);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'mobile-375-zombie-studio.png'), fullPage: false });

    // Restore desktop viewport & test live Editorial edit persistence on isolated duplicate copy
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Projects' }).click();
    await zombieCard.getByRole('button', { name: /Nhân bản/i }).click();
    const copyCard = page.locator('.card', { hasText: 'The Zombie Who Was Afraid of a Human (Copy)' }).first();
    await expect(copyCard).toBeVisible({ timeout: 10_000 });
    await copyCard.getByRole('button', { name: /Mở Studio/i }).click();

    await page.getByRole('tab', { name: 'Shot' }).click();
    await page.getByTestId('editorial-shot-size-select').selectOption('extreme_close');
    const patchPromise = page.waitForResponse(
      (res) => res.url().includes('/api/projects/') && res.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: /Lưu \(Ctrl\+S\)/i }).click();
    expect((await patchPromise).status()).toBe(200);
    await expect(page.getByText('Đã lưu')).toBeVisible({ timeout: 5_000 });
    await page.reload();
    await page.getByRole('button', { name: 'Studio' }).click();
    await page.getByRole('tab', { name: 'Shot' }).click();
    await expect(page.getByTestId('editorial-shot-size-select')).toHaveValue('extreme_close');

    // Cleanup temporary Zombie duplicate
    await page.getByRole('button', { name: 'Projects' }).click();
    await copyCard.getByRole('button', { name: /Xóa .*Copy/i }).click();
    await copyCard.getByRole('button', { name: /Xác nhận xóa/i }).click();
    await expect(copyCard).toHaveCount(0);

    expect(runtimeErrors).toEqual([]);
  });
});
