import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { audio, createRoomWithTracks, enterRoom, expectPlaying, layerName, playingTrackId, type Track } from './room';

interface PlayerEvent {
  type: 'playing' | 'volumechange';
  id: string;
  volume: number;
  at: number;
}

// Logs every `playing` and `volumechange` of the room's audio element with the track it was
// on, so a fade-in can be checked from the player's own state (the video has no sound).
async function recordPlayer(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { playerLog: unknown[] };
    w.playerLog = [];
    for (const type of ['playing', 'volumechange']) {
      window.addEventListener(
        type,
        (e) => {
          const el = e.target as HTMLMediaElement;
          w.playerLog.push({ type, id: el.dataset.trackId, volume: el.volume, at: performance.now() });
        },
        true,
      );
    }
  });
}

const playerLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { playerLog: PlayerEvent[] }).playerLog);

/** Waits for the fade-in of `trackId` to finish and returns how it went. */
async function fadeIn(page: Page, trackId: string) {
  let fade: { startVolume: number; ms: number; rising: boolean } | undefined;
  await expect
    .poll(
      async () => {
        const log = await playerLog(page);
        const start = log.findIndex((e) => e.type === 'playing' && e.id === trackId);
        if (start < 0) return false;
        const volumes = log.slice(start).filter((e) => e.type === 'volumechange' && e.id === trackId);
        const full = volumes.findIndex((e) => e.volume === 1);
        if (full < 0) return false;
        const ramp = volumes.slice(0, full + 1);
        fade = {
          startVolume: log[start]!.volume,
          ms: ramp[full]!.at - log[start]!.at,
          rising: ramp.every((e, i) => i === 0 || e.volume >= ramp[i - 1]!.volume),
        };
        return true;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return fade!;
}

async function expectFadeIn(page: Page, trackId: string) {
  const fade = await fadeIn(page, trackId);
  expect(fade.startVolume, 'volume when the layer starts playing').toBeLessThan(0.1);
  expect(fade.rising, 'volume only rises during the fade').toBe(true);
  expect(fade.ms, 'ms from the layer starting to full volume').toBeGreaterThan(2_500);
  expect(fade.ms).toBeLessThan(4_000);
}

const presentDevices = async (request: APIRequestContext, roomId: string) => {
  const res = await request.get(`/api/rooms/${roomId}/presence`);
  expect(res.status()).toBe(200);
  return (await res.json()).devices as { deviceId: string; trackId: string | null }[];
};

/** The request bodies the page sends to an endpoint ending in `path`. */
function captureRequests(page: Page, path: string) {
  const bodies: Record<string, unknown>[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith(path)) bodies.push(req.postDataJSON());
  });
  return bodies;
}

const trackOf = (tracks: Track[], id: string) => tracks.find((t) => t.id === id)!;

// Pretends the tab went to the background (or the screen locked) and back: headless Chromium
// never hides a page by itself, so this overrides what the page reads and fires the event.
async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((state) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('Opening a room assigns this device a layer, shows the layer name and fades it in over about 3 seconds', async ({
  page,
  request,
}) => {
  const room = await createRoomWithTracks(request, 3);
  await recordPlayer(page);
  await enterRoom(page, room.name);
  const id = await playingTrackId(page);
  await expect(page.getByText(`Now playing: ${layerName(trackOf(room.tracks, id))}`)).toBeVisible();
  expect(await presentDevices(request, room.id), 'the server recorded the layer for this device').toEqual([
    expect.objectContaining({ trackId: id }),
  ]);
  await expectFadeIn(page, id);
  expect(await audio(page).evaluate((a: HTMLAudioElement) => a.volume)).toBe(1);
});

test('When the layer ends, the device requests the next layer and fades it in, and the shown name updates', async ({
  page,
  request,
}) => {
  // Longer than the fade, so each layer reaches full volume before it ends.
  const room = await createRoomWithTracks(request, 3, 4);
  await recordPlayer(page);
  const layerRequests = captureRequests(page, '/layer');
  await enterRoom(page, room.name);
  const first = await playingTrackId(page);
  await expect(page.getByText(`Now playing: ${layerName(trackOf(room.tracks, first))}`)).toBeVisible();

  await expect
    .poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.dataset.trackId), { timeout: 15_000 })
    .not.toBe(first);
  const second = await playingTrackId(page);
  expect(layerRequests.at(-1), 'the next layer was requested with the one that ended').toMatchObject({
    previousTrackId: first,
  });
  await expect(page.getByText(`Now playing: ${layerName(trackOf(room.tracks, second))}`)).toBeVisible();
  await expectFadeIn(page, second);
});

test.describe('The page sends heartbeats while open and releases its layer when closed', () => {
  async function openRoom(page: Page, request: APIRequestContext) {
    const room = await createRoomWithTracks(request, 2);
    const heartbeats = captureRequests(page, '/presence/heartbeat');
    await enterRoom(page, room.name);
    const id = await playingTrackId(page);
    // The first heartbeat follows the assignment within the 10 s interval.
    await expect.poll(() => heartbeats.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    expect(heartbeats[0]).toMatchObject({ trackId: id });
    const { deviceId } = heartbeats[0] as { deviceId: string };
    expect(await presentDevices(request, room.id)).toEqual([expect.objectContaining({ deviceId, trackId: id })]);
    return room;
  }

  // Well under the server's 30 s presence timeout: the device was released, not timed out.
  const expectReleased = (request: APIRequestContext, roomId: string) =>
    expect.poll(() => presentDevices(request, roomId), { timeout: 5_000 }).toEqual([]);

  test('closing the page releases the layer', async ({ page, request }) => {
    const room = await openRoom(page, request);
    await page.close();
    await expectReleased(request, room.id);
  });

  test('leaving for the room list releases the layer', async ({ page, request }) => {
    const room = await openRoom(page, request);
    await page.goBack(); // an in-app navigation: the room page unmounts without a pagehide
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose a room');
    await expectReleased(request, room.id);
  });
});

test.describe('Playback continues with the screen locked or the tab in the background where the browser allows, and recovers when the page returns to the foreground', () => {
  test('layers keep playing and changing while the page is hidden', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 3, 2);
    await enterRoom(page, room.name);
    const first = await playingTrackId(page);
    await setVisibility(page, 'hidden');
    await expect
      .poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.dataset.trackId), { timeout: 10_000 })
      .not.toBe(first);
    await expectPlaying(page);
  });

  test('returning to the page resumes an interrupted layer and re-registers the device', async ({
    page,
    request,
  }) => {
    const room = await createRoomWithTracks(request, 3);
    await enterRoom(page, room.name);
    const id = await playingTrackId(page);
    const [{ deviceId }] = await presentDevices(request, room.id);

    await setVisibility(page, 'hidden');
    // While hidden the OS pauses the audio (a call, another app) and the device's presence
    // expires (the browser froze its timers for longer than 30 s).
    await audio(page).evaluate((a: HTMLAudioElement) => a.pause());
    expect((await request.delete(`/api/rooms/${room.id}/presence/${deviceId}`)).status()).toBe(204);

    await setVisibility(page, 'visible');
    expect(await playingTrackId(page), 'the same layer resumes').toBe(id);
    await expect(page.getByRole('button', { name: 'Tap to listen' })).toHaveCount(0);
    await expect
      .poll(() => presentDevices(request, room.id))
      .toEqual([expect.objectContaining({ deviceId, trackId: id })]);
  });
});

test('An e2e test with two browser contexts in the same room shows them playing different layers', async ({
  browser,
  request,
}, testInfo) => {
  const room = await createRoomWithTracks(request, 3);
  // Two contexts are two separate phones; each records its own video into the report.
  const phones = await Promise.all(
    [1, 2].map(() =>
      browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        recordVideo: { dir: testInfo.outputPath('videos') },
      }),
    ),
  );
  const pages = await Promise.all(phones.map((phone) => phone.newPage()));
  try {
    const ids: string[] = [];
    for (const page of pages) {
      await enterRoom(page, room.name);
      ids.push(await playingTrackId(page));
    }
    expect(ids[0], 'the two phones play different layers').not.toBe(ids[1]);
    for (const [i, page] of pages.entries()) {
      await expectPlaying(page);
      await expect(page.getByText(`Now playing: ${layerName(trackOf(room.tracks, ids[i]!))}`)).toBeVisible();
    }
    const present = await presentDevices(request, room.id);
    expect(present.map((d) => d.trackId).sort()).toEqual([...ids].sort());
  } finally {
    await Promise.all(phones.map((phone) => phone.close()));
    for (const [i, page] of pages.entries()) {
      const video = page.video();
      if (video) await testInfo.attach(`phone-${i + 1}`, { path: await video.path(), contentType: 'video/webm' });
    }
  }
});
