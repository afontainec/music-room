import { defineConfig } from '@playwright/test';

const port = 3100;

export default defineConfig({
  testDir: 'e2e',
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'on-first-retry' },
  webServer: {
    command: 'npm run build && npm run start',
    url: `http://localhost:${port}/api/hello`,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
