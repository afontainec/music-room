import { devices, expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders } from './admin';

const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function createRoom(request: APIRequestContext, name = unique()) {
  const res = await request.post('/api/rooms', { headers: await adminHeaders(request), data: { name } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

const roomLink = (page: Page, name: string) => page.getByRole('link', { name, exact: true });

test('Page lists all existing rooms by name', async ({ page, request }) => {
  const first = await createRoom(request);
  const second = await createRoom(request);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose a room');
  await expect(roomLink(page, first.name)).toBeVisible();
  await expect(roomLink(page, second.name)).toBeVisible();
});

test("Clicking a room navigates the user to that room's page", async ({ page, request }) => {
  const room = await createRoom(request);
  await request.post(`/api/rooms/${room.id}/files/url`, {
    headers: await adminHeaders(request),
    data: { url: 'https://example.com/one.mp3' },
  });
  await page.goto('/');
  await roomLink(page, room.name).click();
  await expect(page).toHaveURL(`/rooms/${room.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
  await expect(page.getByText('1 track', { exact: true })).toBeVisible();
  // The room page also loads directly (server falls back to the SPA) and links back.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
  await page.getByRole('link', { name: 'All rooms' }).click();
  await expect(page).toHaveURL('/');
  await expect(roomLink(page, room.name)).toBeVisible();
});

test('Page updates if rooms are added/removed (on reload)', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose a room');
  const room = await createRoom(request);
  await expect(roomLink(page, room.name)).toHaveCount(0);

  await page.reload();
  await expect(roomLink(page, room.name)).toBeVisible();

  // There is no room delete endpoint yet, so removal is simulated by
  // dropping the room from the real API response on the next load.
  await page.route('/api/rooms', async (route) => {
    const res = await route.fetch();
    const rooms = (await res.json()) as { id: string }[];
    await route.fulfill({ response: res, json: rooms.filter((r) => r.id !== room.id) });
  });
  await page.reload();
  await expect(page.getByRole('list', { name: 'Rooms' })).toBeVisible();
  await expect(roomLink(page, room.name)).toHaveCount(0);
});

test('Shows an error when rooms cannot be loaded', async ({ page }) => {
  await page.route('/api/rooms', (route) => route.fulfill({ status: 500, json: { error: 'boom' } }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toHaveText('Could not load rooms. Please try again later.');
});

test.describe('Works on both desktop and mobile browsers', () => {
  test('desktop: rooms are laid out in a grid', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await createRoom(request);
    await createRoom(request);
    await page.goto('/');
    const cards = page.getByRole('list', { name: 'Rooms' }).getByRole('link');
    const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
    expect(a!.y).toBe(b!.y); // side by side
  });

  test.describe('mobile', () => {
    const { defaultBrowserType: _, ...pixel5 } = devices['Pixel 5'];
    test.use(pixel5);

    test('mobile: rooms stack in one column and open on tap', async ({ page, request }) => {
      const room = await createRoom(request);
      await page.goto('/');
      const link = roomLink(page, room.name);
      await expect(link).toBeVisible();
      const box = (await link.boundingBox())!;
      const width = page.viewportSize()!.width;
      expect(box.width).toBeGreaterThan(width * 0.8); // full-width card
      expect(box.height).toBeGreaterThanOrEqual(44); // touch target
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await link.tap();
      await expect(page).toHaveURL(`/rooms/${room.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
    });
  });
});
