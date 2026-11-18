import { defineConfig } from '@playwright/test';

const e2ePort = Number(process.env.B6_STUDIO_PORT ?? 4310);
const baseURL = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: process.env.B6_STUDIO_PORT ? 'node ../server/dist/index.js' : 'node ../../scripts/dev-runner.mjs --prod',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.B6_STUDIO_PORT,
    timeout: 30_000,
  },
});
