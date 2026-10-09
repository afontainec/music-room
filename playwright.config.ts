import { defineConfig } from '@playwright/test';

const port = 3100;

export default defineConfig({
  testDir: 'e2e',
  retries: process.env.CI ? 2 : 0,
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  // Every test is recorded: the HTML report embeds a video and a trace per test.
  use: { baseURL: `http://localhost:${port}`, video: 'on', trace: 'on' },
  webServer: {
    command: 'npm run build && npm run start',
    url: `http://localhost:${port}/api/hello`,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
