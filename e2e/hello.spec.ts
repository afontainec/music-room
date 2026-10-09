import { expect, test } from '@playwright/test';

test('renders the greeting served by the backend', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hello world from Music World');
});

test('GET /api/hello returns the greeting', async ({ request }) => {
  const res = await request.get('/api/hello');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ message: 'Hello world from Music World' });
});
