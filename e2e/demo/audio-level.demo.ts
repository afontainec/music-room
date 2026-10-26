import { expect, type Page } from '@playwright/test';
import { adminHeaders } from '../admin';
import { silentMp3 } from '../mp3';
import { blockAutoplay, expectPlaying } from '../room';
import { toneWav } from '../wav';
import { caption, click, test } from './screencast';

// Phone size, as in the mockup (see room-selection-restyle.demo.ts for why the video size is set here).
const phone = { width: 393, height: 851 };
test.use({ viewport: phone, video: { mode: 'on', size: phone } });

// The meter has no visual of its own yet, so the captions read its value out.
const level = (page: Page) =>
  page.locator('.room-visual').evaluate((el) => Number(el.getAttribute('data-audio-level')));
const position = (page: Page) => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime);
const percent = (v: number) => `${Math.round(v * 100)}%`;

test('The room page measures how loud its layer is', async ({ page }) => {
  const forest = `Forest ${Math.random().toString(36).slice(2, 6)}`;
  const headers = await adminHeaders(page.request);
  const res = await page.request.post('/api/rooms', { headers, data: { name: forest, colour: '#7fbf95' } });
  const { id } = (await res.json()) as { id: string };
  const up = await page.request.post(`/api/rooms/${id}/files`, {
    headers,
    multipart: { file: { name: 'Thunder.mp3', mimeType: 'audio/mpeg', buffer: silentMp3(60) } },
  });
  const track = (await up.json()) as { id: string };
  // Uploaded test tracks are silent; this layer gets a quiet passage, then a loud one, then silence.
  const body = toneWav([
    { seconds: 8, amplitude: 0.03 },
    { seconds: 10, amplitude: 0.8 },
    { seconds: 30, amplitude: 0 },
  ]);
  await page.route(`**/api/files/${track.id}`, (route) => route.fulfill({ status: 200, contentType: 'audio/wav', body }));

  await blockAutoplay(page);
  await page.goto(`/rooms/${id}`);
  await caption(page, `Nothing plays yet, so the measured loudness is ${percent(await level(page))}`);
  await click(page, page.getByRole('button', { name: 'Tap to listen' }));
  await expectPlaying(page);

  await expect.poll(() => position(page), { timeout: 10_000 }).toBeGreaterThan(4);
  const quiet = await level(page);
  await caption(page, `The layer starts with a quiet passage: loudness ${percent(quiet)}`, 2500);

  await expect.poll(() => position(page), { timeout: 10_000 }).toBeGreaterThan(9.5);
  const loud = await level(page);
  await caption(page, `Then it gets loud: loudness ${percent(loud)}`, 2500);
  expect(loud).toBeGreaterThan(quiet + 0.2);

  await caption(page, 'The visitor turns their own volume right down and mutes…');
  await page.getByRole('slider', { name: 'Volume' }).fill('15');
  await click(page, page.getByRole('button', { name: 'Mute' }));
  const muted = await level(page);
  await caption(page, `…but the meter measures the sound itself: still ${percent(muted)}`, 2500);
  expect(muted).toBeCloseTo(loud, 1);

  await expect.poll(() => position(page), { timeout: 15_000 }).toBeGreaterThan(19);
  const silent = await level(page);
  await caption(page, `When the layer goes silent, the loudness drops to ${percent(silent)}`, 3000);
  expect(silent).toBeLessThan(0.05);
});
