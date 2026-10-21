import { expect } from '@playwright/test';
import { adminHeaders, asStaff } from '../admin';
import { caption, click, test } from './screencast';

// Phone size, as in the mockup. The video size is fixed when the page opens, so it is set here
// rather than with page.setViewportSize, which would leave the page in a corner of a 1280x720 frame.
const phone = { width: 393, height: 851 };
test.use({ viewport: phone, video: { mode: 'on', size: phone } });

test('The room selection page in the dark "Glow" style', async ({ page }) => {
  const suffix = Math.random().toString(36).slice(2, 6);
  const headers = await adminHeaders(page.request);
  const create = async (name: string, colour: string, tracks: number) => {
    const res = await page.request.post('/api/rooms', { headers, data: { name, colour } });
    const { id } = (await res.json()) as { id: string };
    for (let i = 1; i <= tracks; i++) {
      await page.request.post(`/api/rooms/${id}/files/url`, {
        headers,
        data: { url: `https://example.com/layer-${i}.mp3` },
      });
    }
    return id;
  };
  const forest = `Forest ${suffix}`;
  const forestId = await create(forest, '#7fbf95', 3);
  await create(`Ocean ${suffix}`, '#7fa8e0', 1);
  await create(`Night rain ${suffix}`, '#a99be0', 0);

  await asStaff(page);
  await page.goto('/');
  await caption(page, 'Staff open the room list: dark background, Geist type, "Where are you?"', 3000);
  await caption(page, 'Each room is a card with its glowing colour dot, name and layer count', 3000);
  await expect(page.getByRole('link', { name: `Ocean ${suffix}`, exact: true })).toContainText('1 layer');
  await expect(page.getByRole('link', { name: `Night rain ${suffix}`, exact: true })).toContainText('No layers yet');

  const card = page.getByRole('link', { name: forest, exact: true });
  await caption(page, 'Keyboard users see a clear outline on the focused card');
  await card.focus();
  await expect(card).toHaveCSS('outline-style', 'solid');
  await page.waitForTimeout(1500);

  await caption(page, 'The whole card is one link: tap it to enter the room');
  await click(page, card);
  await expect(page).toHaveURL(`/rooms/${forestId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(forest);
  await caption(page, `In "${forest}"`, 2500);
});
