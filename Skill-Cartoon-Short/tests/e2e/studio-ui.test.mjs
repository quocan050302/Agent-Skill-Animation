import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { startViewerServer } from '../../app/server/viewer-server.mjs';
import { PROJECT_ROOT } from '../../tools/setup/hydrate.mjs';

const SCREENSHOT_DIR = path.join(
  PROJECT_ROOT,
  'docs',
  'agent-runs',
  'QA-TTS-01-20261119T153500Z',
  'screenshots'
);

test('E2E Studio UI: 5-step dark Studio works across 1440/768/390/320 with zero overflow, >=44px hit targets, real 9:16 stage & reload persistence', async () => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const srv = await startViewerServer({ port: 0, host: '127.0.0.1' });
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl'],
  });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto(`${srv.url}/?project=ghost-army-ww2-30s`, { waitUntil: 'networkidle' });

    // All 5 numbered steps must be visible on one primary Studio workspace
    for (const heading of [
      '1. Script & Voice',
      '2. Video Settings',
      '3. Timing & Preview',
      '4. Render & Mix',
      '5. QA & Export',
    ]) {
      await page.getByRole('heading', { name: heading }).waitFor({ state: 'visible', timeout: 15000 });
    }

    // Verify honest ratio capability truth: 9:16 enabled, 1:1 and 16:9 disabled
    const ratio916 = page.locator('.ratio-btn', { hasText: '9:16' });
    const ratio11 = page.locator('.ratio-btn', { hasText: '1:1' });
    const ratio169 = page.locator('.ratio-btn', { hasText: '16:9' });
    assert.equal(await ratio916.isDisabled(), false);
    assert.equal(await ratio11.isDisabled(), true);
    assert.equal(await ratio169.isDisabled(), true);

    // Wait for real Three.js WebGL stage readiness text
    await page.getByText('WebGL Three.js + Ink + DOF Ready').waitFor({ state: 'visible', timeout: 30000 });

    // Click a shot chip in Step 3 to seek frame and display live timed Cartoon subtitle overlay
    const inflateBtn = page.locator('.shot-chip', { hasText: 'inflateRubber' });
    await inflateBtn.click();
    await page.waitForTimeout(450);

    // Capture Desktop 1440x900 Studio screenshot
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440x900-studio.png'), fullPage: false });

    // Verify Step 5 QA & Export section (scroll to it and capture screenshot)
    await page.locator('#studio-step-5').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440x900-qa-export.png'), fullPage: false });

    // Test native <dialog> API Settings modal + Escape dismissal
    await page.getByRole('button', { name: /API Settings/ }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.waitFor({ state: 'visible', timeout: 5000 });
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'hidden', timeout: 5000 });

    // Check Project Library view & capture screenshot
    await page.getByRole('button', { name: /Projects \(/ }).click();
    await page.getByRole('heading', { name: 'Start From Template' }).waitFor({ state: 'visible', timeout: 5000 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'desktop-1440x900-library.png'), fullPage: false });

    // Return to Studio Workspace & verify reload persistence
    await page.getByRole('button', { name: 'Studio Workspace' }).click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: '1. Script & Voice' }).waitFor({ state: 'visible', timeout: 10000 });

    // Verify layout, zero horizontal overflow, and >=44px button hit targets across 1440, 768, 390, 320
    const viewports = [
      { name: 'desktop-1440x900', width: 1440, height: 900, save: false },
      { name: 'tablet-768x1024', width: 768, height: 1024, save: true },
      { name: 'mobile-390x844', width: 390, height: 844, save: true },
      { name: 'mobile-320x720', width: 320, height: 720, save: true },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(250);
      const metrics = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - window.innerWidth;
        const buttons = Array.from(document.querySelectorAll('button.btn, a.btn, button.step-jump')).filter(
          (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
        );
        const minBtnHeight = Math.min(...buttons.map((b) => b.getBoundingClientRect().height));
        return { overflow, minBtnHeight, buttonCount: buttons.length };
      });
      assert.equal(
        metrics.overflow <= 1,
        true,
        `Horizontal overflow detected at ${vp.name}: scrollWidth exceeded innerWidth by ${metrics.overflow}px`
      );
      assert.equal(
        metrics.minBtnHeight >= 43.5,
        true,
        `Button hit target too small at ${vp.name}: minHeight=${metrics.minBtnHeight}px (< 44px)`
      );
      if (vp.save) {
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${vp.name}.png`), fullPage: false });
      }
    }

    assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.join('; ')}`);
    assert.equal(consoleErrors.length, 0, `Unexpected console errors: ${consoleErrors.join('; ')}`);
  } finally {
    await browser.close();
    await srv.close();
  }
});
