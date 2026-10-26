import { expect, type Page } from '@playwright/test';
import { adminHeaders } from '../admin';
import { silentMp3 } from '../mp3';
import { audio, blockAutoplay, expectPlaying } from '../room';
import { caption, click, test } from './screencast';

// Phone size, as in the mockup (see room-selection-restyle.demo.ts for why the video size is set here).
const phone = { width: 393, height: 851 };
test.use({ viewport: phone, video: { mode: 'on', size: phone } });

const element = (page: Page) =>
  audio(page).evaluate((a: HTMLAudioElement) => ({ volume: a.volume, muted: a.muted, paused: a.paused }));

test('Visitors set their own volume and mute', async ({ page }) => {
  const forest = `Forest ${Math.random().toString(36).slice(2, 6)}`;
  const headers = await adminHeaders(page.request);
  const res = await page.request.post('/api/rooms', { headers, data: { name: forest, colour: '#7fbf95' } });
  const { id } = (await res.json()) as { id: string };
  for (const layer of ['Birdsong', 'Wind']) {
    await page.request.post(`/api/rooms/${id}/files`, {
      headers,
      multipart: { file: { name: `${layer}.mp3`, mimeType: 'audio/mpeg', buffer: silentMp3(60) } },
    });
  }

  await blockAutoplay(page);
  await page.goto(`/rooms/${id}`);
  await caption(page, 'A visitor opens their room: under the layer are a mute button and a volume slider');
  await click(page, page.getByRole('button', { name: 'Tap to listen' }));
  await expectPlaying(page);

  const slider = page.getByRole('slider', { name: 'Volume' });
  await caption(page, 'The room is loud, so they drag the slider down to about a third');
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 15 });
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.33, box.y + box.height / 2, { steps: 30 });
  await page.mouse.up();
  await expect.poll(async () => (await element(page)).volume).toBeLessThan(0.45);
  await caption(page, `This phone now plays at ${await slider.inputValue()}%; other phones are not affected`, 2500);

  await caption(page, 'Someone starts talking: one tap on the mute button silences this phone');
  const mute = page.getByRole('button', { name: 'Mute' });
  await click(page, mute);
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  expect((await element(page)).muted).toBe(true);
  await caption(page, 'The layer keeps playing silently, so nothing is lost', 2500);

  await caption(page, 'Another tap brings it back at the same level');
  await click(page, mute);
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  const after = await element(page);
  expect(after.muted).toBe(false);
  expect(after.paused).toBe(false);
  await caption(page, 'The settings last for this visit only; a reload starts again at full volume', 3000);
});
