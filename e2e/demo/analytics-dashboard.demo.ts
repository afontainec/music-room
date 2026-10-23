import { expect } from '@playwright/test';
import { asStaff } from '../admin';
import { createRoomWithTracks } from '../room';
import { caption, click, test } from './screencast';

test('Staff see visits and plays per room by date range', async ({ page }) => {
  // A room with three visits from two phones and two plays, as visitors' pages would record them.
  const room = await createRoomWithTracks(page.request, 2);
  for (const deviceId of ['phone-1', 'phone-1', 'phone-2']) {
    await page.request.post(`/api/rooms/${room.id}/visits`, { data: { deviceId } });
  }
  for (const track of room.tracks) {
    await page.request.post(`/api/rooms/${room.id}/plays`, { data: { deviceId: 'phone-1', trackId: track.id } });
  }

  await page.goto('/admin/analytics');
  await expect(page).toHaveURL('/admin/login');
  await caption(page, 'Without a staff login, the analytics page sends you to the login', 3000);

  await asStaff(page);
  await page.goto('/admin');
  await caption(page, 'Logged in, the staff area links to Analytics');
  await click(page, page.getByRole('link', { name: 'Analytics' }));

  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: room.name, exact: true }) });
  await row.scrollIntoViewIfNeeded();
  await caption(page, 'Each room shows its visits, distinct visitors and plays for the last 30 days', 3500);
  await expect(row.getByRole('cell')).toHaveText(['3', '2', '2']);

  await page.getByLabel('From').scrollIntoViewIfNeeded();
  await caption(page, 'Changing the dates updates the report: a range in 2000 has no visits');
  // Date fields take typed digits per segment depending on the locale, so the cursor shows where and fill sets them.
  await click(page, page.getByLabel('From'));
  await page.getByLabel('From').fill('2000-01-01');
  await click(page, page.getByLabel('To'));
  await page.getByLabel('To').fill('2000-12-31');
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByRole('cell')).toHaveText(['0', '0', '0']);
  await caption(page, 'Nothing counted in that range', 2500);

  const today = new Date().toISOString().slice(0, 10);
  await page.getByLabel('From').fill(today);
  await page.getByLabel('To').fill(today);
  await row.scrollIntoViewIfNeeded();
  await caption(page, 'Today alone (UTC) counts them all again', 3000);
  await expect(row.getByRole('cell')).toHaveText(['3', '2', '2']);
});
