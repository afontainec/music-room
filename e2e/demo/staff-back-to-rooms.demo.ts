import { expect } from '@playwright/test';
import { adminHeaders, STAFF } from '../admin';
import { silentMp3 } from '../mp3';
import { caption, click, test, typeInto } from './screencast';

test('Staff get a back button inside a room; visitors never see it', async ({ page }) => {
  const suffix = Date.now().toString(36).slice(-4);
  const forest = `Forest ${suffix}`;
  const headers = await adminHeaders(page.request);
  const ids: string[] = [];
  for (const name of [forest, `Seaside ${suffix}`]) {
    const res = await page.request.post('/api/rooms', { headers, data: { name } });
    const { id } = (await res.json()) as { id: string };
    await page.request.post(`/api/rooms/${id}/files`, {
      headers,
      multipart: { file: { name: 'birds.mp3', mimeType: 'audio/mpeg', buffer: silentMp3(30) } },
    });
    ids.push(id);
  }

  await page.goto(`/rooms/${ids[0]}`);
  await caption(page, 'A visitor opens their room from its link: no way to other rooms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(forest);
  await expect(page.getByRole('link', { name: 'Rooms', exact: true })).toHaveCount(0);

  await page.goto('/admin/login');
  await caption(page, 'Staff log in');
  await typeInto(page, page.getByLabel('Username'), STAFF.username);
  await typeInto(page, page.getByLabel('Password'), STAFF.password);
  await click(page, page.getByRole('button', { name: 'Log in' }));
  await expect(page).toHaveURL('/admin');

  await page.goto(`/rooms/${ids[0]}`);
  await caption(page, 'In the same room, staff now see "← Rooms"');
  const back = page.getByRole('link', { name: 'Rooms', exact: true });
  await expect(back).toBeVisible();

  await caption(page, 'Clicking it goes back to every room, and the music stops');
  await click(page, back);
  await expect(page).toHaveURL('/');
  await expect(page.locator('audio')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Rooms' }).getByRole('link')).not.toHaveCount(0);

  await caption(page, 'Staff go back into the room, then log out in another tab');
  await click(page, page.getByRole('link', { name: forest, exact: true }));
  await expect(back).toBeVisible();
  const other = await page.context().newPage();
  await other.goto('/admin');
  await other.getByRole('button', { name: 'Log out' }).click();
  await other.close();

  await expect(back).toHaveCount(0);
  await caption(page, 'The button is gone without a reload', 2500);
});
