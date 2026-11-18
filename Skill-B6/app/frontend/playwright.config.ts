import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4310',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node ../../scripts/dev-runner.mjs --prod',
    url: 'http://127.0.0.1:4310/api/health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
