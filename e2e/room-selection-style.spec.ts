import { devices, expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, asStaff } from './admin';

// The room selection page restyled per docs/design/visual-style.md, and the shared tokens.

const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const { defaultBrowserType: _, ...pixel5 } = devices['Pixel 5'];

async function createRoom(request: APIRequestContext, tracks = 0, colour?: string) {
  const headers = await adminHeaders(request);
  const res = await request.post('/api/rooms', { headers, data: { name: unique(), colour } });
  expect(res.status()).toBe(201);
  const room = (await res.json()) as { id: string; name: string; colour: string };
  for (let i = 1; i <= tracks; i++) {
    const added = await request.post(`/api/rooms/${room.id}/files/url`, {
      headers,
      data: { url: `https://example.com/layer-${i}.mp3` },
    });
    expect(added.status()).toBe(201);
  }
  return room;
}

const cards = (page: Page) => page.getByRole('list', { name: 'Rooms' }).getByRole('link');
const card = (page: Page, name: string) => page.getByRole('link', { name, exact: true });
const css = (page: Page, selector: string, property: string) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

test.describe('Matches mockup at phone width: header label, "Where are you?" title, responsive card grid', () => {
  test.use(pixel5);

  test('phone: label, title and a two-column grid on the dark background', async ({ page, request }) => {
    await asStaff(page);
    await Promise.all([createRoom(request), createRoom(request), createRoom(request)]);
    await page.goto('/');
    await expect(page.getByText('Music Rooms', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where are you?');
    await expect(page.getByText('Pick the room you are in.', { exact: false })).toBeVisible();

    const [a, b, c] = await Promise.all([0, 1, 2].map((i) => cards(page).nth(i).boundingBox()));
    expect(a!.y).toBe(b!.y); // two side by side
    expect(c!.y).toBeGreaterThan(a!.y); // the third wraps to the next row
    expect(a!.height).toBe(164);
    const width = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    expect(await css(page, 'body', 'background-color')).toBe('rgb(13, 17, 16)');
    expect(await css(page, 'h1', 'font-size')).toBe('36px');
    expect(await css(page, 'h1', 'font-weight')).toBe('300');
    expect(await css(page, 'h1', 'font-family')).toContain('Geist');
  });
});

test('wide screen: the grid has more columns, within a 960px column', async ({ page, request }) => {
  await asStaff(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await Promise.all([createRoom(request), createRoom(request), createRoom(request), createRoom(request)]);
  await page.goto('/');
  const boxes = await Promise.all([0, 1, 2, 3].map((i) => cards(page).nth(i).boundingBox()));
  expect(new Set(boxes.map((box) => box!.y)).size).toBe(1); // four in one row
  const list = (await page.getByRole('list', { name: 'Rooms' }).boundingBox())!;
  expect(list.width).toBeLessThanOrEqual(960);
});

test('Each card shows colour dot, name, layer count ("1 layer"/"No layers yet")', async ({ page, request }) => {
  await asStaff(page);
  const empty = await createRoom(request, 0, '#7fa8e0');
  const one = await createRoom(request, 1, '#e0ae7f');
  const two = await createRoom(request, 2);
  await page.goto('/');

  await expect(card(page, empty.name)).toContainText(empty.name);
  await expect(card(page, empty.name).locator('.room-tile-layers')).toHaveText('No layers yet');
  await expect(card(page, one.name).locator('.room-tile-layers')).toHaveText('1 layer');
  await expect(card(page, two.name).locator('.room-tile-layers')).toHaveText('2 layers');
  // The layer count is the card's description, so the link is still named by the room alone.
  await expect(card(page, one.name)).toHaveAccessibleDescription('1 layer');

  const dot = card(page, empty.name).locator('.room-tile-dot');
  await expect(dot).toHaveCSS('background-color', 'rgb(127, 168, 224)');
  await expect(dot).toHaveCSS('box-shadow', 'rgb(127, 168, 224) 0px 0px 24px 0px');
  await expect(dot).toHaveCSS('width', '36px');
  await expect(card(page, one.name).locator('.room-tile-dot')).toHaveCSS('background-color', 'rgb(224, 174, 127)');
  // A room created without a colour still gets its palette colour from the API.
  await expect(card(page, two.name).locator('.room-tile-dot')).toHaveCSS('background-color', /^rgb\(/);
});

test('Cards are single links, visible focus outline, ≥44px tap target', async ({ page, request }) => {
  await asStaff(page);
  const room = await createRoom(request, 1);
  await page.goto('/');
  const item = page.getByRole('list', { name: 'Rooms' }).getByRole('listitem').filter({ hasText: room.name });
  await expect(item.getByRole('link')).toHaveCount(1);
  await expect(item.getByRole('link')).toContainText('1 layer');

  const link = card(page, room.name);
  const box = (await link.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);

  // Tab to the card: keyboard focus shows a 2px outline in the text colour.
  await expect(link).toHaveCSS('outline-style', 'none');
  for (let i = 0; i < 100 && !(await link.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(link).toBeFocused();
  await expect(link).toHaveCSS('outline-style', 'solid');
  await expect(link).toHaveCSS('outline-width', '2px');
  await expect(link).toHaveCSS('outline-color', 'rgb(237, 239, 238)');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`/rooms/${room.id}`);
});

test.describe('Loading/error(+retry)/empty states use new style', () => {
  test('loading shows the header and a muted line, nothing about rooms', async ({ page }) => {
    await asStaff(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('/api/rooms', async (route) => {
      await held;
      await route.fulfill({ json: [] });
    });
    await page.goto('/');
    const loading = page.getByRole('status');
    await expect(loading).toHaveText('Loading…');
    await expect(loading).toHaveCSS('color', 'rgb(152, 163, 158)');
    await expect(page.getByText('Music Rooms', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading')).toHaveCount(0);
    release();
    await expect(page.getByText('No rooms yet.')).toBeVisible();
  });

  test('error keeps the title and offers a retry button that reloads the list', async ({ page, request }) => {
    await asStaff(page);
    const room = await createRoom(request);
    let fail = true;
    await page.route('/api/rooms', (route) =>
      fail ? route.fulfill({ status: 500, json: { error: 'boom' } }) : route.fallback(),
    );
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where are you?');
    await expect(page.getByRole('alert')).toHaveText('Could not load rooms. Please try again later.');
    await expect(page.getByRole('alert')).toHaveCSS('color', 'rgb(152, 163, 158)');
    const retry = page.getByRole('button', { name: 'Try again' });
    expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    fail = false;
    await retry.click();
    await expect(card(page, room.name)).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('empty shows the title and a muted "No rooms yet."', async ({ page }) => {
    await asStaff(page);
    await page.route('/api/rooms', (route) => route.fulfill({ json: [] }));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where are you?');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-weight', '300');
    await expect(page.getByText('No rooms yet.')).toHaveCSS('color', 'rgb(152, 163, 158)');
    await expect(page.getByRole('list', { name: 'Rooms' })).toHaveCount(0);
  });
});

test('Colours and fonts defined once (tokens) and reusable by other pages', async ({ page, request }) => {
  const room = await createRoom(request);
  const tokens = () =>
    page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        bg: root.getPropertyValue('--bg').trim(),
        text: root.getPropertyValue('--text').trim(),
        sky: root.getPropertyValue('--room-sky').trim(),
        sans: root.getPropertyValue('--font-sans').trim().replace(/["']/g, ''),
        mono: root.getPropertyValue('--font-mono').trim().replace(/["']/g, ''),
        body: getComputedStyle(document.body).backgroundColor,
      };
    });
  const expected = {
    bg: '#0d1110',
    text: '#edefee',
    sky: '#7fa8e0',
    sans: 'Geist, system-ui, sans-serif',
    mono: 'Geist Mono, ui-monospace, monospace',
    body: 'rgb(13, 17, 16)',
  };
  // The same tokens apply on the room page and in the staff area, not only on the selection page.
  for (const path of ['/', `/rooms/${room.id}`, '/admin/login']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await tokens()).toEqual(expected);
  }
});
