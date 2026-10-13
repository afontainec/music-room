import { devices, expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { silentMp3 } from './mp3';

const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

interface Track {
  id: string;
  originalName: string;
}

// A room with `count` uploaded tracks (real, silent mp3s so the browser can play them).
async function createRoomWithTracks(request: APIRequestContext, count: number) {
  const res = await request.post('/api/rooms', { data: { name: unique() } });
  expect(res.status()).toBe(201);
  const room = (await res.json()) as { id: string; name: string };
  const tracks: Track[] = [];
  for (let i = 1; i <= count; i++) {
    const up = await request.post(`/api/rooms/${room.id}/files`, {
      multipart: { file: { name: `track-${i}.mp3`, mimeType: 'audio/mpeg', buffer: silentMp3(30) } },
    });
    expect(up.status()).toBe(201);
    tracks.push(await up.json());
  }
  return { ...room, tracks };
}

// Opening a room from the selection page is a click, which lets browsers autoplay.
async function enterRoom(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

const audio = (page: Page) => page.locator('audio');

/** Waits until the audio element is really playing (not paused, position advancing). */
async function expectPlaying(page: Page) {
  await expect
    .poll(() => audio(page).evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0.2), { timeout: 10_000 })
    .toBe(true);
}

async function playingTrackId(page: Page): Promise<string> {
  await expectPlaying(page);
  const { id, src } = await audio(page).evaluate((a: HTMLAudioElement) => ({
    id: a.dataset.trackId!,
    src: a.currentSrc,
  }));
  expect(new URL(src).pathname).toBe(`/api/files/${id}`);
  return id;
}

test("Entering a room triggers playback of a randomly selected mp3 from that room's list", async ({
  page,
  request,
}) => {
  const room = await createRoomWithTracks(request, 3);
  await enterRoom(page, room.name);
  const id = await playingTrackId(page);
  const track = room.tracks.find((t) => t.id === id);
  expect(track, 'the playing track belongs to the room').toBeDefined();
  await expect(page.getByText(`Now playing: ${track!.originalName}`)).toBeVisible();
});

test.describe('Playback starts automatically or via a single play button (browser permitting)', () => {
  test('starts automatically when the browser allows autoplay', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    await expect(page.getByRole('button', { name: 'Play' })).toHaveCount(0);
  });

  test('falls back to one Play button when autoplay is blocked', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    // Loading the room URL directly gives no user gesture, so Chromium (like Safari) blocks
    // autoplay. Firefox may allow it for this silent test track and simply play.
    await page.goto(`/rooms/${room.id}`);
    const play = page.getByRole('button', { name: 'Play' });
    await expect(play).toBeVisible();
    expect(await audio(page).evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
    await play.click();
    await expectPlaying(page);
    await expect(play).toHaveCount(0);
  });
});

test.describe('No repeat of the exact same file twice in a row if more than one file exists', () => {
  test('re-entering a two-track room alternates tracks', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    const played: string[] = [];
    for (let i = 0; i < 5; i++) {
      await enterRoom(page, room.name);
      played.push(await playingTrackId(page));
    }
    for (let i = 1; i < played.length; i++) expect(played[i], `visit ${i + 1}`).not.toBe(played[i - 1]);
  });

  test('a one-track room replays its only file', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1);
    await enterRoom(page, room.name);
    expect(await playingTrackId(page)).toBe(room.tracks[0]!.id);
    await enterRoom(page, room.name);
    expect(await playingTrackId(page)).toBe(room.tracks[0]!.id);
  });

  test('a room without files says so instead of playing', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 0);
    await enterRoom(page, room.name);
    await expect(page.getByText('This room has no tracks yet.')).toBeVisible();
    await expect(audio(page)).toHaveCount(0);
  });
});

// CI installs Chromium only; these cover desktop and a touch device with the strict
// autoplay policy mobile Safari applies (play starts from a tap on the Play button).
test.describe('Works reliably across major browsers (Chrome, Safari, Firefox)', () => {
  test('desktop: plays on entering the room', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
  });

  test.describe('mobile', () => {
    const { defaultBrowserType: _, ...pixel5 } = devices['Pixel 5'];
    test.use(pixel5);

    test('mobile: a tap on Play starts playback when autoplay is blocked', async ({ page, request }) => {
      const room = await createRoomWithTracks(request, 2);
      await page.goto(`/rooms/${room.id}`);
      const play = page.getByRole('button', { name: 'Play' });
      const box = (await play.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44); // touch target
      await play.tap();
      await expectPlaying(page);
    });
  });
});
