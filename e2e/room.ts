import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { silentMp3 } from './mp3';

const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface Track {
  id: string;
  originalName: string;
}

// A room with `count` uploaded tracks (real, silent mp3s so the browser can play them).
export async function createRoomWithTracks(request: APIRequestContext, count: number, seconds = 30) {
  const res = await request.post('/api/rooms', { data: { name: unique() } });
  expect(res.status()).toBe(201);
  const room = (await res.json()) as { id: string; name: string };
  const tracks: Track[] = [];
  for (let i = 1; i <= count; i++) {
    const up = await request.post(`/api/rooms/${room.id}/files`, {
      multipart: { file: { name: `track-${i}.mp3`, mimeType: 'audio/mpeg', buffer: silentMp3(seconds) } },
    });
    expect(up.status()).toBe(201);
    tracks.push(await up.json());
  }
  return { ...room, tracks };
}

// Opening a room from the selection page is a click, which lets browsers autoplay.
export async function enterRoom(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

export const audio = (page: Page) => page.locator('audio');

// Under Playwright the browser's own autoplay block is unreliable: Playwright's scripted page
// access counts as user activation, so play() may or may not be allowed on a fresh page load.
// This applies the policy deterministically: play() is rejected until a real input event.
export async function blockAutoplay(page: Page) {
  await page.addInitScript(() => {
    let gesture = false;
    for (const type of ['pointerdown', 'touchend', 'keydown', 'click']) {
      window.addEventListener(type, (e) => (gesture ||= e.isTrusted), true);
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!gesture) return Promise.reject(new DOMException('play() needs a user gesture', 'NotAllowedError'));
      return play.call(this);
    };
  });
}

/** Waits until the audio element is really playing (not paused, position advancing). */
export async function expectPlaying(page: Page) {
  await expect
    .poll(() => audio(page).evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0.2), { timeout: 10_000 })
    .toBe(true);
}

export async function playingTrackId(page: Page): Promise<string> {
  await expectPlaying(page);
  const { id, src } = await audio(page).evaluate((a: HTMLAudioElement) => ({
    id: a.dataset.trackId!,
    src: a.currentSrc,
  }));
  expect(new URL(src).pathname).toBe(`/api/files/${id}`);
  return id;
}
