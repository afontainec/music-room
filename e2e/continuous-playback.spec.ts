import { expect, test, type Page } from '@playwright/test';
import { audio, blockAutoplay, createRoomWithTracks, enterRoom, expectPlaying, layerName } from './room';

// Short tracks so several play back to back within a test.
const TRACK_SECONDS = 2;

interface MediaEvent {
  type: 'playing' | 'ended';
  id: string;
  at: number;
}

// Logs every `playing` and `ended` of any media element (media events do not bubble, but they
// pass the window during capture), and keeps every element that was ever played.
async function recordPlayback(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { mediaLog: unknown[]; mediaElements: Set<HTMLMediaElement> };
    w.mediaLog = [];
    w.mediaElements = new Set();
    for (const type of ['playing', 'ended']) {
      window.addEventListener(
        type,
        (e) => {
          const el = e.target as HTMLMediaElement;
          w.mediaElements.add(el);
          w.mediaLog.push({ type, id: el.dataset.trackId, at: performance.now() });
        },
        true,
      );
    }
  });
}

const mediaLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { mediaLog: MediaEvent[] }).mediaLog);

/** The tracks played so far, in order: one entry per track started. */
async function playedTracks(page: Page): Promise<string[]> {
  const played: string[] = [];
  let ended = true;
  for (const e of await mediaLog(page)) {
    if (e.type === 'ended') ended = true;
    else if (ended) {
      played.push(e.id);
      ended = false;
    }
  }
  return played;
}

async function waitForTracks(page: Page, count: number) {
  await expect
    .poll(async () => (await playedTracks(page)).length, { timeout: count * TRACK_SECONDS * 1000 + 15_000 })
    .toBeGreaterThanOrEqual(count);
  return playedTracks(page);
}

test.describe('After a track finishes, a new random track auto-plays without user action', () => {
  test('tracks keep playing one after another after entering the room', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 3, TRACK_SECONDS);
    await recordPlayback(page);
    await enterRoom(page, room.name);
    const played = await waitForTracks(page, 4);
    const ids = room.tracks.map((t) => t.id);
    for (const id of played) expect(ids, 'every track belongs to the room').toContain(id);
    await expectPlaying(page);
    await expect(page.getByRole('button', { name: 'Tap to listen' })).toHaveCount(0);
    const current = room.tracks.find((t) => t.id === played.at(-1))!;
    await expect(page.getByText(`Now playing: ${layerName(current)}`)).toBeVisible();
  });

  test('one tap on "Tap to listen" is enough when autoplay is blocked', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 3, TRACK_SECONDS);
    await blockAutoplay(page);
    await recordPlayback(page);
    await page.goto(`/rooms/${room.id}`);
    await page.getByRole('button', { name: 'Tap to listen' }).click();
    await waitForTracks(page, 3);
    await expectPlaying(page);
    await expect(page.getByRole('button', { name: 'Tap to listen' })).toHaveCount(0);
  });
});

test('No noticeable silence gap longer than 1 second between tracks', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 3, TRACK_SECONDS);
  await recordPlayback(page);
  await enterRoom(page, room.name);
  await waitForTracks(page, 4);
  const log = await mediaLog(page);
  const gaps: number[] = [];
  log.forEach((e, i) => {
    if (e.type !== 'ended') return;
    const next = log.slice(i + 1).find((n) => n.type === 'playing');
    if (next) gaps.push(next.at - e.at);
  });
  expect(gaps.length).toBeGreaterThanOrEqual(3);
  for (const gap of gaps) expect(gap, 'ms from one track ending to the next playing').toBeLessThan(1000);
});

test.describe('Avoids immediate repeat of the just-played track when possible', () => {
  test('a two-track room alternates its tracks', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2, TRACK_SECONDS);
    await recordPlayback(page);
    await enterRoom(page, room.name);
    const played = await waitForTracks(page, 4);
    for (let i = 1; i < played.length; i++) expect(played[i], `track ${i + 1}`).not.toBe(played[i - 1]);
  });

  test('a one-track room keeps replaying its only track', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1, TRACK_SECONDS);
    await recordPlayback(page);
    await enterRoom(page, room.name);
    const played = await waitForTracks(page, 3);
    expect(new Set(played)).toEqual(new Set([room.tracks[0]!.id]));
    await expectPlaying(page);
  });
});

test('User can leave the room to stop playback', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 2, TRACK_SECONDS);
  await recordPlayback(page);
  await enterRoom(page, room.name);
  await waitForTracks(page, 2);
  await expectPlaying(page);

  await page.getByRole('link', { name: '← All rooms' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose a room');
  await expect(audio(page)).toHaveCount(0);
  const eventsAtLeave = (await mediaLog(page)).length;

  // Longer than a track: had the loop kept going, the next track would have started by now.
  await page.waitForTimeout(TRACK_SECONDS * 1000 + 1500);
  const stillPlaying = await page.evaluate(() =>
    [...(window as unknown as { mediaElements: Set<HTMLMediaElement> }).mediaElements].some((a) => !a.paused),
  );
  expect(stillPlaying, 'no audio element is still playing').toBe(false);
  const after = (await mediaLog(page)).slice(eventsAtLeave);
  expect(after.filter((e) => e.type === 'playing'), 'no track started after leaving').toEqual([]);
});
