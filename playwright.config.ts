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
  // Tests keep a video and trace only when they fail; the screencast of a PR is its demo (e2e/demo).
  use: { baseURL: `http://localhost:${port}`, video: 'retain-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'tests', testIgnore: '**/demo/**' },
    {
      // `npm run demo`: scripted walkthroughs recorded at 720p for the pull request comment.
      name: 'demo',
      testDir: 'e2e/demo',
      testMatch: '**/*.demo.ts',
      retries: 0,
      use: {
        viewport: { width: 1280, height: 720 },
        video: { mode: 'on', size: { width: 1280, height: 720 } },
        trace: 'off',
      },
    },
  ],
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
