import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, asStaff } from './admin';
import { audio, createRoomWithTracks, expectPlaying, playingTrackId, shownLayer } from './room';

// The home page lists every room for visitors who are not logged in (issue #82).

const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** '#7fa8e0' → 'rgb(127, 168, 224)', the form computed styles report. */
const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

async function createRoom(request: APIRequestContext, colour: string) {
  const res = await request.post('/api/rooms', { headers: await adminHeaders(request), data: { name: unique(), colour } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; name: string; colour: string };
}

const rooms = (page: Page) => page.getByRole('list', { name: 'Rooms' });
const roomLink = (page: Page, name: string) => rooms(page).getByRole('link', { name, exact: true });
const tapToListen = (page: Page) => page.getByRole('button', { name: 'Tap to listen' });
// "← Rooms" on the room page, shown to staff only.
const staffBackLink = (page: Page) => page.getByRole('link', { name: 'Rooms', exact: true });

test('A logged-out visitor who opens the home page sees all rooms with their names and colours', async ({
  page,
  request,
}) => {
  const moss = await createRoom(request, '#7fbf95');
  const sky = await createRoom(request, '#7fa8e0');

  const response = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/rooms');
  await page.goto('/');
  const listed = (await (await response).json()) as { name: string }[];
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where are you?');
  for (const room of [moss, sky]) {
    await expect(roomLink(page, room.name)).toBeVisible();
    await expect(roomLink(page, room.name).locator('.room-tile-dot')).toHaveCSS('background-color', rgb(room.colour));
  }
  // Every room the public list returned, not a subset.
  expect(listed.length).toBeGreaterThanOrEqual(2);
  await expect(rooms(page).getByRole('link')).toHaveCount(listed.length);
  expect(await page.evaluate(() => localStorage.getItem('music-room.staffToken'))).toBeNull();
});

test.describe("Clicking a room opens /rooms/:id and playback behaves as before, including the 'Tap to listen' fallback", () => {
  test('the click lets the layer autoplay', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await page.goto('/');
    await roomLink(page, room.name).click();
    await expect(page).toHaveURL(`/rooms/${room.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
    const id = await playingTrackId(page);
    expect(room.tracks.map((t) => t.id)).toContain(id);
    await expect(shownLayer(page)).toHaveText(room.tracks.find((t) => t.id === id)!.originalName.replace(/\.mp3$/, ''));
    await expect(tapToListen(page)).toHaveCount(0);
  });

  test('when the browser still blocks autoplay, "Tap to listen" starts the layer', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    // A browser that does not count the room card click as permission to play: play() is rejected
    // until a click on a button (the "Tap to listen" control).
    await page.addInitScript(() => {
      let allowed = false;
      window.addEventListener('click', (e) => (allowed ||= e.isTrusted && (e.target as Element).closest('button') !== null), true);
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (!allowed) return Promise.reject(new DOMException('play() needs a user gesture', 'NotAllowedError'));
        return play.call(this);
      };
    });
    await page.goto('/');
    await roomLink(page, room.name).click();
    await expect(page).toHaveURL(`/rooms/${room.id}`);
    await expect(tapToListen(page)).toBeVisible();
    expect(await audio(page).evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);

    await tapToListen(page).click();
    await expectPlaying(page);
    await expect(tapToListen(page)).toHaveCount(0);
  });
});

test('With no rooms, the page shows a clear empty state instead of an error', async ({ page }) => {
  await page.route('/api/rooms', (route) => route.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where are you?');
  await expect(page.getByText('No rooms yet.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(rooms(page)).toHaveCount(0);
});

test.describe('Staff still see their existing admin controls and logged-out visitors see none', () => {
  test('logged-out visitors: only room links on the home page, no staff link in the room', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1);
    await page.goto('/');
    await expect(roomLink(page, room.name)).toBeVisible();
    // Every link on the page is a room card; nothing points at the staff area.
    expect(await page.getByRole('link').count()).toBe(await rooms(page).getByRole('link').count());
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);

    await roomLink(page, room.name).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
    await expect(staffBackLink(page)).toHaveCount(0);
    await expect(page.getByRole('link')).toHaveCount(0);
  });

  test('staff: the same list, and the room page keeps their "Rooms" link back to it', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1);
    await asStaff(page);
    await page.goto('/');
    await roomLink(page, room.name).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
    await expect(staffBackLink(page)).toBeVisible();
    await staffBackLink(page).click();
    await expect(page).toHaveURL('/');
    await expect(roomLink(page, room.name)).toBeVisible();
  });
});

test('Joining via direct URL or QR code keeps working for logged-out visitors', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1);
  await page.goto(`/rooms/${room.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
  await expect(shownLayer(page)).toHaveText('track-1');
});
