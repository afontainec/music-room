import { expect } from '@playwright/test';
import { adminHeaders, STAFF } from '../admin';
import { caption, click, test, typeInto } from './screencast';

test('The room list is for staff; visitors open their room from a link', async ({ page }) => {
  const room = `Forest ${Date.now().toString(36).slice(-4)}`;
  const created = await page.request.post('/api/rooms', { headers: await adminHeaders(page.request), data: { name: room } });
  const { id } = (await created.json()) as { id: string };

  await page.goto('/');
  await caption(page, 'A visitor without a login opens the home page: no room list is shown');
  await expect(page.getByText('Open your room from the link you were given.', { exact: false })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Rooms' })).toHaveCount(0);

  const anonymous = await page.request.get('/api/rooms');
  expect(anonymous.status()).toBe(401);
  await caption(page, `The room list API answers ${anonymous.status()} to anonymous requests`);

  await caption(page, 'A direct link to a room still works for anyone');
  await page.goto(`/rooms/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room);

  await caption(page, 'Staff log in');
  await page.goto('/admin/login');
  await typeInto(page, page.getByLabel('Username'), STAFF.username);
  await typeInto(page, page.getByLabel('Password'), STAFF.password);
  await click(page, page.getByRole('button', { name: 'Log in' }));
  await expect(page).toHaveURL('/admin');

  await caption(page, 'and on the home page they see every room');
  await page.goto('/');
  await expect(page.getByRole('list', { name: 'Rooms' }).getByRole('link', { name: room, exact: true })).toBeVisible();
  await caption(page, `"${room}" is listed for staff`, 2500);
});
