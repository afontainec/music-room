import { expect } from '@playwright/test';
import { adminHeaders, asStaff } from '../admin';
import { silentMp3 } from '../mp3';
import { blockAutoplay, expectPlaying, shownLayer } from '../room';
import { caption, click, test } from './screencast';

// Phone size, as in the mockup (see room-selection-restyle.demo.ts for why the video size is set here).
const phone = { width: 393, height: 851 };
test.use({ viewport: phone, video: { mode: 'on', size: phone } });

test('The room page in the dark "Mono" style', async ({ page }) => {
  const forest = `Forest ${Math.random().toString(36).slice(2, 6)}`;
  const headers = await adminHeaders(page.request);
  const res = await page.request.post('/api/rooms', { headers, data: { name: forest, colour: '#7fbf95' } });
  const { id } = (await res.json()) as { id: string };
  // Short layers, so the next one comes within the demo.
  for (const [layer, seconds] of [['Birdsong', 6], ['Wind', 6]] as const) {
    await page.request.post(`/api/rooms/${id}/files`, {
      headers,
      multipart: { file: { name: `${layer}.mp3`, mimeType: 'audio/mpeg', buffer: silentMp3(seconds) } },
    });
  }

  // Opening a link directly gives no tap yet, so the browser blocks the sound.
  await blockAutoplay(page);
  await page.goto(`/rooms/${id}`);
  await caption(page, 'A visitor opens their room link: the rings glow in the room\'s colour', 3000);
  await caption(page, 'Below them, "Your layer" and the name of the layer this phone plays', 3000);
  const first = (await shownLayer(page).textContent())!;
  await expect(page.getByRole('link')).toHaveCount(0);

  await caption(page, 'The browser blocked the sound, so "Tap to listen" is the full-width button');
  await click(page, page.getByRole('button', { name: 'Tap to listen' }));
  await expectPlaying(page);

  await caption(page, 'When the layer ends, the next one fades in and its name replaces the old one', 3000);
  await expect(shownLayer(page)).not.toHaveText(first, { timeout: 15_000 });
  await caption(page, `Now "${await shownLayer(page).textContent()}"`, 2000);

  await asStaff(page);
  await page.reload();
  await caption(page, 'Staff with a session also see "← Rooms" at the top', 2500);
  await expect(page.getByRole('link', { name: 'Rooms', exact: true })).toBeVisible();
});
