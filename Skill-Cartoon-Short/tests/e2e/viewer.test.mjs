import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startViewerServer } from '../../app/server/viewer-server.mjs';

test('E2E: Loopback 9:16 real-engine test viewer renders both Soldier baseline and Zombie 10s proof', async () => {
  const srv = await startViewerServer({ port: 0, host: '127.0.0.1' });
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__viewerReady === true, null, { timeout: 60000 });

    const badgeText = await page.locator('.badge').textContent();
    assert.match(badgeText, /9:16 LOCKED/);

    const statusSoldier = JSON.parse(await page.locator('#statusBox').textContent());
    assert.equal(statusSoldier.projectId, 'soldier-baseline');
    assert.equal(statusSoldier.totalFrames, 592);
    assert.equal(statusSoldier.canvas, '1080x1920');

    // Switch to new 10s Zombie Supermarket project in viewer
    await page.selectOption('#projectSelect', 'zombie-supermarket-10s');
    await page.waitForFunction(
      () => {
        try {
          const st = JSON.parse(document.getElementById('statusBox').textContent);
          return st.projectId === 'zombie-supermarket-10s' && st.engineReady === true;
        } catch {
          return false;
        }
      },
      null,
      { timeout: 60000 }
    );
    const statusZombie = JSON.parse(await page.locator('#statusBox').textContent());
    assert.equal(statusZombie.totalFrames, 300);
    assert.equal(statusZombie.canvas, '1080x1920');
  } finally {
    await browser.close();
    await srv.close();
  }
});
