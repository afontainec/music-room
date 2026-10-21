import { expect } from '@playwright/test';
import { adminHeaders, asStaff } from '../admin';
import { caption, click, test } from './screencast';

// The demo project's default 1280x720: the wide-screen layout, next to the phone demo in
// room-selection-restyle.demo.ts.
test('The room selection page on a wide screen', async ({ page }) => {
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
  const ocean = `Ocean ${suffix}`;
  await create(`Forest ${suffix}`, '#7fbf95', 3);
  const oceanId = await create(ocean, '#7fa8e0', 2);
  await create(`Night rain ${suffix}`, '#a99be0', 1);
  await create(`Desert wind ${suffix}`, '#e0ae7f', 4);
  await create(`Ember ${suffix}`, '#e08a84', 0);
  await create(`Lagoon ${suffix}`, '#6cc4c0', 2);

  await asStaff(page);
  await page.goto('/');
  await caption(page, 'On a wide screen the room list is a centred column, at most 960px wide', 3000);

  const grid = page.getByRole('list', { name: 'Rooms' });
  const columns = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBeGreaterThan(2);
  await caption(page, `The grid fits more cards per row: ${columns} columns here, two on a phone`, 3000);

  const card = page.getByRole('link', { name: ocean, exact: true });
  await caption(page, 'Click a card to enter its room');
  await click(page, card);
  await expect(page).toHaveURL(`/rooms/${oceanId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ocean);
  await caption(page, `In "${ocean}"`, 2500);
});
