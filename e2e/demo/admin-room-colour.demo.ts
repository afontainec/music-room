import { expect } from '@playwright/test';
import { STAFF } from '../admin';
import { caption, click, test, typeInto } from './screencast';

test('Staff choose a room colour when creating it and change it afterwards', async ({ page }) => {
  const forest = `Forest ${Date.now().toString(36).slice(-4)}`;

  await page.goto('/admin/login');
  await caption(page, 'Staff log in');
  await typeInto(page, page.getByLabel('Username'), STAFF.username);
  await typeInto(page, page.getByLabel('Password'), STAFF.password);
  await click(page, page.getByRole('button', { name: 'Log in' }));
  await expect(page).toHaveURL('/admin');

  const newColours = page.getByRole('group', { name: 'New room colour' });
  await expect(newColours.getByRole('radio', { checked: true })).toHaveCount(1);
  await caption(page, 'The new room form shows the palette, with the default colour already selected', 3000);

  await caption(page, 'Staff pick Moss instead and create the room');
  await click(page, newColours.locator('label', { hasText: 'Moss' }));
  await expect(newColours.getByRole('radio', { name: 'Moss' })).toBeChecked();
  await typeInto(page, page.getByLabel('New room name'), forest);
  await click(page, page.getByRole('button', { name: 'Create room' }));
  const link = page.getByRole('list', { name: 'Rooms' }).getByRole('link', { name: forest, exact: true });
  await expect(link).toBeVisible();

  await caption(page, "On the room's staff page, its current colour is Moss");
  await click(page, link);
  await expect(page.getByText('Current colour: Moss')).toBeVisible();

  await caption(page, 'Staff change it to Teal and save');
  const colours = page.getByRole('group', { name: 'Room colour' });
  await click(page, colours.locator('label', { hasText: 'Teal' }));
  await click(page, page.getByRole('button', { name: 'Save colour' }));

  await expect(page.getByText('Current colour: Teal')).toBeVisible();
  const id = page.url().split('/').pop()!;
  const room = (await (await page.request.get(`/api/rooms/${id}`)).json()) as { colour: string };
  expect(room.colour).toBe('#6cc4c0');
  await caption(page, 'Saved: the room is now Teal for visitors too', 2500);
});
