import { expect, test, type Page } from '@playwright/test';
import { audio, blockAutoplay, createRoomWithTracks, enterRoom, expectPlaying, type Track } from './room';
import { toneWav, type Segment } from './wav';

// The room page measures its layer's loudness (hooks/useAudioLevel.ts) and exposes it on the
// rings as data-audio-level. Uploaded test tracks are silent mp3s, so tests that need sound serve
// a WAV of tone in place of a track's file (both the audio element's request and the meter's own).

const level = (page: Page) =>
  page.locator('.room-visual').evaluate((el) => Number(el.getAttribute('data-audio-level')));

const position = (page: Page) => audio(page).evaluate((a: HTMLAudioElement) => a.currentTime);

async function serveSound(page: Page, tracks: Track[], segments: Segment[]) {
  const body = toneWav(segments);
  for (const track of tracks) {
    await page.route(`**/api/files/${track.id}`, (route) =>
      route.fulfill({ status: 200, contentType: 'audio/wav', body }),
    );
  }
}

/** Waits until the layer has played past `from` seconds, then reads the level (before `to`). */
async function levelAfter(page: Page, from: number, to: number) {
  await expect.poll(() => position(page), { timeout: 20_000 }).toBeGreaterThan(from);
  const reading = await page.evaluate(() => ({
    time: document.querySelector('audio')!.currentTime,
    level: Number(document.querySelector('.room-visual')!.getAttribute('data-audio-level')),
  }));
  expect(reading.time, 'read inside the passage').toBeLessThan(to);
  return reading.level;
}

/** Every value data-audio-level takes during `ms`. */
const recordLevels = (page: Page, ms: number) =>
  page.locator('.room-visual').evaluate(
    (el, ms) =>
      new Promise<number[]>((resolve) => {
        const values: number[] = [];
        const observer = new MutationObserver(() => values.push(Number(el.getAttribute('data-audio-level'))));
        observer.observe(el, { attributes: true, attributeFilter: ['data-audio-level'] });
        setTimeout(() => {
          observer.disconnect();
          resolve(values);
        }, ms);
      }),
    ms,
  );

const steady: Segment[] = [{ seconds: 30, amplitude: 0.5 }];

test.describe('A normalised loudness value (0-1) is available to the room page and updates continuously', () => {
  test('the room page exposes the layer’s loudness between 0 and 1, updated at least 20 times a second', async ({
    page,
    request,
  }) => {
    const room = await createRoomWithTracks(request, 1);
    await serveSound(page, room.tracks, [{ seconds: 30, amplitude: 0.8, wobble: { hz: 2, low: 0.02 } }]);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    await levelAfter(page, 3.5, 25); // past the fade-in

    const values = await recordLevels(page, 1000);
    expect(values.length, 'changes in one second').toBeGreaterThanOrEqual(20);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...values) - Math.min(...values), 'follows the swells').toBeGreaterThan(0.2);
  });
});

test.describe('Value is near 0 during silence or gaps between tracks and rises with louder passages', () => {
  test('silence measures near 0, a quiet passage more, and a loud passage more still', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1);
    await serveSound(page, room.tracks, [
      { seconds: 4, amplitude: 0 },
      { seconds: 3, amplitude: 0.03 },
      { seconds: 3, amplitude: 0.8 },
      { seconds: 4, amplitude: 0 },
    ]);
    await enterRoom(page, room.name);
    await expectPlaying(page);

    expect(await levelAfter(page, 3, 4), 'silence').toBeLessThan(0.05);
    const quiet = await levelAfter(page, 5.5, 7);
    const loud = await levelAfter(page, 8.5, 10);
    expect(quiet, 'a quiet passage').toBeGreaterThan(0.2);
    expect(loud, 'a loud passage').toBeGreaterThan(quiet + 0.2);
    expect(await levelAfter(page, 11.5, 14), 'silence again').toBeLessThan(0.05);
  });

  test('a silent track measures 0 while it plays', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    expect(await levelAfter(page, 4, 30)).toBe(0);
  });

  test('the value falls to near 0 in the gap between one layer and the next', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1);
    await serveSound(page, room.tracks, [{ seconds: 6, amplitude: 0.8 }]);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    expect(await levelAfter(page, 4, 6), 'while the layer plays').toBeGreaterThan(0.8);

    // Locally the next layer arrives within milliseconds; a slow network leaves a real gap.
    await page.route('**/api/rooms/*/layer', async (route) => {
      await new Promise((done) => setTimeout(done, 1000));
      await route.continue();
    });
    await audio(page).evaluate((a: HTMLAudioElement) => new Promise((done) => a.addEventListener('ended', done, { once: true })));
    const values = await recordLevels(page, 1500);
    expect(Math.min(...values), 'between layers').toBeLessThan(0.05);
  });
});

test.describe('Changing the listener’s volume or muting does not change the measured value', () => {
  test('the level stays the same after turning the volume down and after muting', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1);
    await serveSound(page, room.tracks, steady);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    const before = await levelAfter(page, 4, 30);
    expect(before).toBeGreaterThan(0.7);

    await page.getByRole('slider', { name: 'Volume' }).fill('20');
    await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.volume)).toBeCloseTo(0.2);
    await page.waitForTimeout(500);
    expect(await level(page), 'at 20% volume').toBeCloseTo(before, 1);

    await page.getByRole('button', { name: 'Mute' }).click();
    expect(await audio(page).evaluate((a: HTMLAudioElement) => a.muted)).toBe(true);
    await page.waitForTimeout(500);
    expect(await level(page), 'muted').toBeCloseTo(before, 1);
  });
});

test.describe('Audible playback is unchanged: no added latency, glitches, or break in the continuous loop or autoplay fallback', () => {
  test('the audio element is never routed through Web Audio and still fades in to full volume', async ({
    page,
    request,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __webAudio: number };
      w.__webAudio = 0;
      const create = AudioContext.prototype.createMediaElementSource;
      AudioContext.prototype.createMediaElementSource = function (el) {
        w.__webAudio++;
        return create.call(this, el);
      };
    });
    const room = await createRoomWithTracks(request, 1);
    await serveSound(page, room.tracks, steady);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    await expect.poll(() => level(page), { timeout: 8_000 }).toBeGreaterThan(0.7);
    await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.volume), { timeout: 8_000 }).toBe(1);
    expect(await page.evaluate(() => (window as unknown as { __webAudio: number }).__webAudio)).toBe(0);
  });

  test('“Tap to listen” still starts a blocked layer, and the level rises once it plays', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1);
    await serveSound(page, room.tracks, steady);
    await blockAutoplay(page);
    await page.goto(`/rooms/${room.id}`);
    const tap = page.getByRole('button', { name: 'Tap to listen' });
    await expect(tap).toBeVisible();
    expect(await level(page), 'nothing plays yet').toBe(0);

    await tap.click();
    await expectPlaying(page);
    await expect(tap).toBeHidden();
    await expect.poll(() => level(page), { timeout: 8_000 }).toBeGreaterThan(0.7);
  });

  test('the next layer still starts when one ends, and is measured too', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await serveSound(page, room.tracks, [{ seconds: 4, amplitude: 0.8 }]);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    const first = await audio(page).evaluate((a: HTMLAudioElement) => a.dataset.trackId);

    await expect
      .poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.dataset.trackId), { timeout: 15_000 })
      .not.toBe(first);
    await expectPlaying(page);
    await expect.poll(() => level(page), { timeout: 8_000 }).toBeGreaterThan(0.7);
  });
});

test.describe('If measurement is unsupported, the page still plays audio normally', () => {
  test('without Web Audio the layer plays and the level stays 0', async ({ page, request }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      delete w.OfflineAudioContext;
      delete w.webkitOfflineAudioContext;
    });
    const room = await createRoomWithTracks(request, 1);
    await serveSound(page, room.tracks, steady);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    expect(await levelAfter(page, 4, 30)).toBe(0);
    await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.volume), { timeout: 8_000 }).toBe(1);
  });

  test('when the track cannot be fetched for measuring (e.g. no CORS), the layer plays and the level stays 0', async ({
    page,
    request,
  }) => {
    const room = await createRoomWithTracks(request, 1);
    const body = toneWav(steady);
    await page.route(`**/api/files/${room.tracks[0].id}`, (route) =>
      route.request().resourceType() === 'media'
        ? route.fulfill({ status: 200, contentType: 'audio/wav', body })
        : route.abort('accessdenied'),
    );
    await enterRoom(page, room.name);
    await expectPlaying(page);
    expect(await levelAfter(page, 4, 30)).toBe(0);
  });
});
