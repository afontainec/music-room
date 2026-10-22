import { expect } from '@playwright/test';
import { adminHeaders } from '../admin';
import { silentMp3 } from '../mp3';
import { expectPlaying, shownLayer } from '../room';
import { caption, click, test } from './screencast';

test('Room visits and track plays are logged and reported per room', async ({ page }) => {
  const room = `Forest ${Date.now().toString(36).slice(-4)}`;
  const headers = await adminHeaders(page.request);
  const created = await page.request.post('/api/rooms', { headers, data: { name: room } });
  const { id } = (await created.json()) as { id: string };
  // Short layers, so the device moves on to its next one during the demo.
  for (const layer of ['birds', 'wind']) {
    await page.request.post(`/api/rooms/${id}/files`, {
      headers,
      multipart: { file: { name: `${layer}.mp3`, mimeType: 'audio/mpeg', buffer: silentMp3(4) } },
    });
  }
  const today = new Date().toISOString().slice(0, 10);
  const usage = async () => {
    const res = await page.request.get('/api/analytics/rooms', { headers, params: { from: today, to: today } });
    return ((await res.json()).rooms as { id: string; visits: number; plays: number }[]).find((r) => r.id === id)!;
  };

  await page.goto(`/rooms/${id}`);
  await caption(page, 'A visitor opens the room link: entering the room logs one visit');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room);
  const tap = page.getByRole('button', { name: 'Tap to listen' });
  if (await tap.isVisible()) await click(page, tap);

  await caption(page, `Their layer starts playing: "${(await shownLayer(page).textContent())!.trim()}", logged as a play`);
  await expectPlaying(page);

  await caption(page, 'When it ends the next layer starts, and that is another play', 3000);
  await expect.poll(async () => (await usage()).plays, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await caption(page, `Now playing "${(await shownLayer(page).textContent())!.trim()}"`);

  const { visits, plays } = await usage();
  expect(visits).toBe(1);
  await caption(page, `Staff report for ${today} (UTC): "${room}" has ${visits} visit and ${plays} plays`, 3500);
});
