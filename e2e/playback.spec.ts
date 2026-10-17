import { devices, expect, test } from '@playwright/test';
import { audio, blockAutoplay, createRoomWithTracks, enterRoom, expectPlaying, layerName, playingTrackId } from './room';

test("Entering a room triggers playback of a randomly selected mp3 from that room's list", async ({
  page,
  request,
}) => {
  const room = await createRoomWithTracks(request, 3);
  await enterRoom(page, room.name);
  const id = await playingTrackId(page);
  const track = room.tracks.find((t) => t.id === id);
  expect(track, 'the playing track belongs to the room').toBeDefined();
  await expect(page.getByText(`Now playing: ${layerName(track!)}`)).toBeVisible();
});

test.describe('Playback starts automatically or via a single play button (browser permitting)', () => {
  test('starts automatically when the browser allows autoplay', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    await expect(page.getByRole('button', { name: 'Tap to listen' })).toHaveCount(0);
  });

  test('falls back to one "Tap to listen" button when autoplay is blocked', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    // Loading the room URL directly gives no user gesture, so the browser blocks autoplay.
    await blockAutoplay(page);
    await page.goto(`/rooms/${room.id}`);
    const play = page.getByRole('button', { name: 'Tap to listen' });
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
// autoplay policy mobile Safari applies (play starts from a tap on "Tap to listen").
test.describe('Works reliably across major browsers (Chrome, Safari, Firefox)', () => {
  test('desktop: plays on entering the room', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
  });

  test.describe('mobile', () => {
    const { defaultBrowserType: _, ...pixel5 } = devices['Pixel 5'];
    test.use(pixel5);

    test('mobile: a tap on "Tap to listen" starts playback when autoplay is blocked', async ({ page, request }) => {
      const room = await createRoomWithTracks(request, 2);
      await blockAutoplay(page);
      await page.goto(`/rooms/${room.id}`);
      const play = page.getByRole('button', { name: 'Tap to listen' });
      await expect(play).toBeVisible();
      const box = (await play.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44); // touch target
      await play.tap();
      await expectPlaying(page);
    });
  });
});
