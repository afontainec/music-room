import { expect } from '@playwright/test';
import { STAFF } from '../admin';
import { silentMp3 } from '../mp3';
import { caption, click, test, typeInto } from './screencast';

test('Staff build a forest soundscape and a visitor hears one of its layers', async ({ page }) => {
  const room = `Forest ${Date.now().toString(36).slice(-4)}`;

  await page.goto('/admin/login');
  await caption(page, 'Staff log in to the staff area');
  await typeInto(page, page.getByLabel('Username'), STAFF.username);
  await typeInto(page, page.getByLabel('Password'), STAFF.password);
  await click(page, page.getByRole('button', { name: 'Log in' }));
  await expect(page).toHaveURL('/admin');

  await caption(page, `They create a room called "${room}"`);
  await typeInto(page, page.getByLabel('New room name'), room);
  await click(page, page.getByRole('button', { name: 'Create room' }));
  const roomLink = page.getByRole('list', { name: 'Rooms' }).getByRole('link', { name: room, exact: true });
  await expect(roomLink).toBeVisible();
  await click(page, roomLink);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room);

  await caption(page, 'and upload its layers: birds, wind and a water stream');
  for (const layer of ['birds', 'wind', 'water-stream']) {
    await page.getByLabel('Mp3 file').setInputFiles({ name: `${layer}.mp3`, mimeType: 'audio/mpeg', buffer: silentMp3(60) });
    await click(page, page.getByRole('button', { name: 'Upload' }));
    await expect(page.getByRole('list', { name: 'Tracks' })).toContainText(layer);
  }

  await caption(page, 'The room is opened from the room list (staff only), as a visitor would from its link');
  await page.goto('/');
  await click(page, page.getByRole('link', { name: room, exact: true }));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room);

  await caption(page, 'Their device is given one layer, which fades in');
  const nowPlaying = page.locator('.now-playing');
  await expect(nowPlaying).toContainText('Now playing', { timeout: 15_000 });
  const mine = (await nowPlaying.locator('strong').textContent())!.trim();

  // A second device joining now: the server hands it a different layer than this one.
  const roomId = new URL(page.url()).pathname.split('/').pop()!;
  const res = await page.request.post(`/api/rooms/${roomId}/layer`, { data: { deviceId: 'demo-second-phone' } });
  const other = (await res.json()).track.name as string;
  expect(other).not.toBe(mine);
  await caption(page, `This device plays "${mine}"; a second phone joining now gets "${other}"`, 3500);
});
