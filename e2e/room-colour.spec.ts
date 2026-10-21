import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { adminHeaders, asStaff } from './admin';

// Each room's colour (docs/design/visual-style.md) on the room selection cards and the room page.

const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** '#7fa8e0' → 'rgb(127, 168, 224)', the form computed styles report. */
const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

async function createRoom(request: APIRequestContext, colour?: string) {
  const headers = await adminHeaders(request);
  const res = await request.post('/api/rooms', { headers, data: { name: unique(), colour } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; name: string; colour: string };
}

async function setColour(request: APIRequestContext, id: string, colour: string) {
  const res = await request.patch(`/api/rooms/${id}`, { headers: await adminHeaders(request), data: { colour } });
  expect(res.status()).toBe(200);
}

/** The colour the API returns for a room in the list: stored, or derived from its id. */
async function listedColour(request: APIRequestContext, id: string) {
  const res = await request.get('/api/rooms', { headers: await adminHeaders(request) });
  const rooms = (await res.json()) as { id: string; colour: string }[];
  return rooms.find((room) => room.id === id)!.colour;
}

const cardDot = (page: Page, name: string) =>
  page.getByRole('link', { name, exact: true }).locator('.room-tile-dot');

const svgStyle = (locator: Locator, property: string) =>
  locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);

async function expectRingsIn(page: Page, colour: string) {
  const visual = page.locator('.room-visual');
  await expect(visual.locator('.room-ring-inner')).toHaveCSS('stroke', rgb(colour));
  await expect(visual.locator('.room-ring-dot')).toHaveCSS('fill', rgb(colour));
  const stops = visual.locator('.room-glow stop');
  await expect(stops).toHaveCount(2);
  for (const stop of await stops.all()) await expect(stop).toHaveCSS('stop-color', rgb(colour));
}

test("Room selection cards show each room's dot and glow in its stored/derived colour", async ({ page, request }) => {
  const sky = await createRoom(request, '#7fa8e0');
  const coral = await createRoom(request, '#e08a84');
  const assigned = await createRoom(request); // the server picks its colour
  await asStaff(page);
  await page.goto('/');

  for (const room of [sky, coral, assigned]) {
    const colour = await listedColour(request, room.id);
    expect(colour).toBe(room.colour);
    const dot = cardDot(page, room.name);
    await expect(dot).toHaveCSS('background-color', rgb(colour));
    await expect(dot).toHaveCSS('box-shadow', `${rgb(colour)} 0px 0px 24px 0px`);
  }
});

test("The room page's inner ring, centre dot and glow use the room's colour", async ({ page, request }) => {
  const lavender = await createRoom(request, '#a99be0');
  const gold = await createRoom(request, '#d9c46a');

  for (const room of [lavender, gold]) {
    await page.goto(`/rooms/${room.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
    await expectRingsIn(page, room.colour);
  }
  // The three outer rings keep the ring tokens, whatever the room's colour.
  const visual = page.locator('.room-visual');
  await expect(visual.locator('.room-ring-1')).toHaveCSS('stroke', 'rgb(27, 34, 32)');
  await expect(visual.locator('.room-ring-2')).toHaveCSS('stroke', 'rgb(38, 48, 44)');
  await expect(visual.locator('.room-ring-3')).toHaveCSS('stroke', 'rgb(54, 66, 61)');
  // Decoration only: the rings are hidden from assistive technology.
  await expect(visual.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(await svgStyle(visual.locator('svg'), 'width')).toBe('280px');
});

test('Changing a colour in the admin area shows up in the public app without a restart', async ({ page, request }) => {
  const room = await createRoom(request, '#7fbf95');
  await asStaff(page);
  await page.goto('/');
  await expect(cardDot(page, room.name)).toHaveCSS('background-color', rgb('#7fbf95'));

  // The room list is read on every visit.
  await setColour(request, room.id, '#6cc4c0');
  await page.reload();
  await expect(cardDot(page, room.name)).toHaveCSS('background-color', rgb('#6cc4c0'));

  // An open room page picks up the change when it returns to view, without a reload.
  await page.getByRole('link', { name: room.name, exact: true }).click();
  await expectRingsIn(page, '#6cc4c0');
  await setColour(request, room.id, '#d98fb8');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expectRingsIn(page, '#d98fb8');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
});
