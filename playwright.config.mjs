import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '*.spec.ts',
  workers: 1,
  timeout: 40000,
  use: {
    baseURL: 'http://127.0.0.1:5176',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5176',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: true,
  },
});
