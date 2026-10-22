import { devices, expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, asStaff } from './admin';

const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function createRoom(request: APIRequestContext, name = unique()) {
  const res = await request.post('/api/rooms', { headers: await adminHeaders(request), data: { name } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; name: string };
}

const roomLink = (page: Page, name: string) => page.getByRole('link', { name, exact: true });

// The room list is staff only (see the anonymous visitor test), so the other tests start logged in.

test('Non-staff visitor opening the room list URL sees a friendly message and no room names', async ({
  page,
  request,
}) => {
  const room = await createRoom(request);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ask for a room link');
  await expect(page.getByText('Ask the staff here for the link to your room', { exact: false })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Rooms' })).toHaveCount(0);
  await expect(page.getByText(room.name)).toHaveCount(0);
  expect(await page.content()).not.toContain(room.name);
  // The only link is the staff login, none to a room.
  await expect(page.getByRole('link')).toHaveText(['Log in']);
});

test('A visitor with an expired staff session also sees the friendly message', async ({ page, request }) => {
  const room = await createRoom(request);
  await page.addInitScript(() => localStorage.setItem('music-room.staffToken','not-a-valid-token'));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ask for a room link');
  await expect(page.getByText(room.name)).toHaveCount(0);
});

test('Public visitors see no navigation to other rooms while in a room', async ({ page, request }) => {
  const room = await createRoom(request);
  await request.post(`/api/rooms/${room.id}/files/url`, {
    headers: await adminHeaders(request),
    data: { url: 'https://example.com/one.mp3' },
  });
  await page.goto(`/rooms/${room.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
  await expect(page.locator('.layer-name')).toHaveText('one');
  await expect(page.getByRole('link')).toHaveCount(0);
  await expect(page.getByText('Rooms', { exact: true })).toHaveCount(0);
});

test('Opening a room URL directly as a visitor still works and refresh reopens the same room', async ({
  page,
  request,
}) => {
  const room = await createRoom(request);
  await page.goto(`/rooms/${room.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
  await page.reload();
  await expect(page).toHaveURL(`/rooms/${room.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
});

test('Page lists all existing rooms by name', async ({ page, request }) => {
  await asStaff(page);
  const first = await createRoom(request);
  const second = await createRoom(request);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where are you?');
  await expect(roomLink(page, first.name)).toBeVisible();
  await expect(roomLink(page, second.name)).toBeVisible();
});

test("Clicking a room navigates the user to that room's page", async ({ page, request }) => {
  await asStaff(page);
  const room = await createRoom(request);
  await request.post(`/api/rooms/${room.id}/files/url`, {
    headers: await adminHeaders(request),
    data: { url: 'https://example.com/one.mp3' },
  });
  await page.goto('/');
  await roomLink(page, room.name).click();
  await expect(page).toHaveURL(`/rooms/${room.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
  await expect(page.locator('.layer-name')).toHaveText('one');
  // The room page also loads directly (server falls back to the SPA); staff go back with the browser.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(roomLink(page, room.name)).toBeVisible();
});

test('Page updates if rooms are added/removed (on reload)', async ({ page, request }) => {
  await asStaff(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where are you?');
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
    await asStaff(page);
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

    test('mobile: rooms sit two to a row and open on tap', async ({ page, request }) => {
      await asStaff(page);
      const room = await createRoom(request);
      await page.goto('/');
      const link = roomLink(page, room.name);
      await expect(link).toBeVisible();
      const box = (await link.boundingBox())!;
      const width = page.viewportSize()!.width;
      expect(box.width).toBeGreaterThan(width * 0.35); // half-width card (two columns)
      expect(box.width).toBeLessThan(width * 0.5);
      expect(box.height).toBeGreaterThanOrEqual(44); // touch target
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await link.tap();
      await expect(page).toHaveURL(`/rooms/${room.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
    });
  });
});
