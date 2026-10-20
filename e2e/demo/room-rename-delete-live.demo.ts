import { expect } from '@playwright/test';
import { adminHeaders, asStaff } from '../admin';
import { silentMp3 } from '../mp3';
import { caption, click, test } from './screencast';

test('Listeners see a room rename live and are told when the room is deleted', async ({ page }) => {
  const suffix = Date.now().toString(36).slice(-4);
  const forest = `Forest ${suffix}`;
  const night = `Night forest ${suffix}`;
  const headers = await adminHeaders(page.request);
  const res = await page.request.post('/api/rooms', { headers, data: { name: forest } });
  const { id } = (await res.json()) as { id: string };
  for (const name of ['birds.mp3', 'wind.mp3']) {
    await page.request.post(`/api/rooms/${id}/files`, {
      headers,
      multipart: { file: { name, mimeType: 'audio/mpeg', buffer: silentMp3(90) } },
    });
  }

  await asStaff(page);
  await page.goto('/');
  await caption(page, 'A listener opens the forest room');
  await click(page, page.getByRole('link', { name: forest, exact: true }));
  const player = page.locator('audio');
  await expect.poll(() => player.evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0.2)).toBe(true);

  await caption(page, `Meanwhile staff rename it to "${night}"`);
  await page.request.patch(`/api/rooms/${id}`, { headers, data: { name: night } });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(night, { timeout: 15_000 });
  expect(await player.evaluate((a: HTMLAudioElement) => !a.paused)).toBe(true);
  await caption(page, 'The new name shows up and the layer keeps playing');

  await caption(page, 'Now staff delete the room');
  await page.request.delete(`/api/rooms/${id}`, { headers });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This room has closed', { timeout: 15_000 });
  await expect(player).toHaveCount(0);
  await caption(page, 'The listener is told, and the audio stops');

  await click(page, page.getByRole('button', { name: 'Back to room selection' }));
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: night, exact: true })).toHaveCount(0);
  await caption(page, 'Back on room selection, the deleted room is gone', 2500);
});
