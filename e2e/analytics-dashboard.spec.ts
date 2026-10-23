import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { asStaff, signToken } from './admin';
import { createRoomWithTracks } from './room';

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Three visits from two devices and two plays in the first room, one visit in the second, none in the third. */
async function seedUsage(request: APIRequestContext) {
  const forest = await createRoomWithTracks(request, 2);
  const beach = await createRoomWithTracks(request, 1);
  const quiet = await createRoomWithTracks(request, 1);
  for (const deviceId of ['phone-1', 'phone-1', 'phone-2']) {
    expect((await request.post(`/api/rooms/${forest.id}/visits`, { data: { deviceId } })).status()).toBe(204);
  }
  for (const track of forest.tracks) {
    await request.post(`/api/rooms/${forest.id}/plays`, { data: { deviceId: 'phone-1', trackId: track.id } });
  }
  await request.post(`/api/rooms/${beach.id}/visits`, { data: { deviceId: 'phone-3' } });
  return { forest, beach, quiet };
}

/** The room's row in the report as [visits, visitors, plays] (the test database is shared). */
async function counts(page: Page, roomName: string) {
  const table = page.getByRole('table', { name: 'Per room' });
  const row = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: roomName, exact: true }) });
  await expect(row).toHaveCount(1);
  return row.getByRole('cell').allTextContents();
}

test('A simple report or dashboard shows visit counts and play counts per room', async ({ page, request }) => {
  const { forest, beach, quiet } = await seedUsage(request);
  await asStaff(page);
  // Staff reach the report from the staff area.
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Analytics' }).click();
  await expect(page).toHaveURL('/admin/analytics');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Analytics');

  const table = page.getByRole('table', { name: 'Per room' });
  await expect(table.getByRole('columnheader')).toHaveText(['Room', 'Visits', 'Visitors', 'Plays']);
  await expect.poll(() => counts(page, forest.name)).toEqual(['3', '2', '2']);
  expect(await counts(page, beach.name)).toEqual(['1', '1', '0']);
  // Rooms without events are listed with zeros.
  expect(await counts(page, quiet.name)).toEqual(['0', '0', '0']);

  // The back link returns to the staff area.
  await page.getByRole('link', { name: 'Staff area' }).click();
  await expect(page).toHaveURL('/admin');
});

test('Data is viewable by date range', async ({ page, request }) => {
  const { forest } = await seedUsage(request);
  await asStaff(page);
  await page.goto('/admin/analytics');

  // The report starts on the last 30 days (UTC), which include today's events.
  const today = todayUtc();
  await expect(page.getByLabel('To')).toHaveValue(today);
  await expect.poll(() => counts(page, forest.name)).toEqual(['3', '2', '2']);

  // A range before the events counts none of them; the table follows each date change.
  await page.getByLabel('From').fill('2000-01-01');
  await page.getByLabel('To').fill('2000-12-31');
  await expect.poll(() => counts(page, forest.name)).toEqual(['0', '0', '0']);

  // Today alone counts them all again.
  await page.getByLabel('From').fill(today);
  await page.getByLabel('To').fill(today);
  await expect.poll(() => counts(page, forest.name)).toEqual(['3', '2', '2']);

  // A start after the end is refused in the page, without a request.
  await page.getByLabel('From').fill('2030-01-02');
  await page.getByLabel('To').fill('2030-01-01');
  await expect(page.getByRole('alert')).toHaveText('The start date must be on or before the end date.');
  await expect(page.getByRole('table', { name: 'Per room' })).toHaveCount(0);

  // Emptying a date leaves that end open.
  await page.getByLabel('From').fill('');
  await page.getByLabel('To').fill('');
  await expect.poll(() => counts(page, forest.name)).toEqual(['3', '2', '2']);
});

test('Only authenticated staff can access the dashboard', async ({ page, request }) => {
  // Without a login the page sends visitors to the staff login, and the report API refuses them.
  await page.goto('/admin/analytics');
  await expect(page).toHaveURL('/admin/login');
  await expect(page.getByRole('table')).toHaveCount(0);
  expect((await request.get('/api/analytics/rooms')).status()).toBe(401);

  // An expired session is sent to the login as well.
  const expired = signToken({ sub: 'staff', exp: Math.floor(Date.now() / 1000) - 60 });
  await page.evaluate((token) => localStorage.setItem('music-room.staffToken', token), expired);
  await page.goto('/admin/analytics');
  await expect(page).toHaveURL('/admin/login');
  await expect(page.getByRole('table')).toHaveCount(0);
});
