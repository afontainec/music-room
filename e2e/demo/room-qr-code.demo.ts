import { expect } from '@playwright/test';
import { adminHeaders, STAFF } from '../admin';
import { silentMp3 } from '../mp3';
import { caption, click, test, typeInto } from './screencast';

test('Staff open a room’s QR code page to share its link', async ({ page }) => {
  const forest = `Forest ${Date.now().toString(36).slice(-4)}`;
  const headers = await adminHeaders(page.request);
  const res = await page.request.post('/api/rooms', { headers, data: { name: forest } });
  const { id } = (await res.json()) as { id: string };
  await page.request.post(`/api/rooms/${id}/files`, {
    headers,
    multipart: { file: { name: 'birds.mp3', mimeType: 'audio/mpeg', buffer: silentMp3(30) } },
  });

  await page.goto(`/admin/rooms/${id}/qrcode`);
  await caption(page, 'Without a staff session, the QR code page sends you to the login');
  await expect(page).toHaveURL('/admin/login');
  await typeInto(page, page.getByLabel('Username'), STAFF.username);
  await typeInto(page, page.getByLabel('Password'), STAFF.password);
  await click(page, page.getByRole('button', { name: 'Log in' }));
  await expect(page).toHaveURL('/admin');

  await caption(page, 'Staff open the room in the staff area');
  await click(page, page.getByRole('link', { name: new RegExp(`^${forest}`) }));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(forest);

  await caption(page, 'A "Share this room" card sits right under the room name');
  await click(page, page.getByRole('link', { name: 'Share this room', exact: true }));

  const url = new URL(`/rooms/${id}`, page.url()).href;
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(forest);
  await expect(page.getByRole('img', { name: `QR code for ${url}` })).toBeVisible();
  await expect(page.getByRole('link', { name: url, exact: true })).toBeVisible();
  await caption(page, 'Visitors scan the code, or type the link shown below it', 3000);

  await caption(page, 'The link opens the room for a visitor');
  await click(page, page.getByRole('link', { name: url, exact: true }));
  await expect(page).toHaveURL(url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(forest);
});
