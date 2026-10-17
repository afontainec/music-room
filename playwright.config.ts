import { defineConfig } from '@playwright/test';

const port = 3100;
// Same default as .env.example (docker compose up -d locally, a service container in CI).
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://music_room:music_room@localhost:5432/music_room';

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
    command: 'npm run build && npm run db:migrate && npm run start',
    url: `http://localhost:${port}/api/hello`,
    // The staff account matches e2e/admin.ts.
    env: {
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      STORAGE_DIR: 'test-results/uploads',
      ADMIN_USERNAME: 'staff',
      ADMIN_PASSWORD: 'e2e-staff-password',
      AUTH_SECRET: 'e2e-auth-secret',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
