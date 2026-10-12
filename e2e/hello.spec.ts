import { expect, test } from '@playwright/test';

// The page at / is now the room selection page (e2e/room-selection.spec.ts).
test('GET /api/hello returns the greeting', async ({ request }) => {
  const res = await request.get('/api/hello');
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ message: 'Hello world from Music World' });
});
