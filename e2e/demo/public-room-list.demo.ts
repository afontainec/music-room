import { expect } from '@playwright/test';
import { adminHeaders } from '../admin';
import { caption, click, test } from './screencast';

test('The room list is public; changing rooms stays for staff', async ({ page }) => {
  const room = `Forest ${Date.now().toString(36).slice(-4)}`;
  const created = await page.request.post('/api/rooms', { headers: await adminHeaders(page.request), data: { name: room } });
  const { id } = (await created.json()) as { id: string };

  await page.goto('/');
  await caption(page, 'A visitor without a login opens the home page: every room is listed');
  const link = page.getByRole('list', { name: 'Rooms' }).getByRole('link', { name: room, exact: true });
  await expect(link).toBeVisible();

  const list = await page.request.get('/api/rooms');
  expect(list.status()).toBe(200);
  const listed = ((await list.json()) as Record<string, unknown>[]).find((r) => r.id === id)!;
  expect(Object.keys(listed).sort()).toEqual(['colour', 'id', 'name', 'trackCount']);
  await caption(page, `The room list API answers ${list.status()} without a login, with only ${Object.keys(listed).join(', ')}`);

  const rename = await page.request.patch(`/api/rooms/${id}`, { data: { name: 'Hacked' } });
  const remove = await page.request.delete(`/api/rooms/${id}`);
  expect([rename.status(), remove.status()]).toEqual([401, 401]);
  await caption(page, `Renaming or deleting a room without a login still answers ${rename.status()}`);

  await caption(page, 'The visitor picks their room');
  await click(page, link);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room);
  await caption(page, `In "${room}"`, 2500);
});
