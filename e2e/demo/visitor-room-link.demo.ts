import { expect } from '@playwright/test';
import { adminHeaders } from '../admin';
import { caption, test } from './screencast';

test('Visitors stay in the room their link opens', async ({ page }) => {
  const room = `Forest ${Date.now().toString(36).slice(-4)}`;
  const headers = await adminHeaders(page.request);
  const created = await page.request.post('/api/rooms', { headers, data: { name: room } });
  const { id } = (await created.json()) as { id: string };
  await page.request.post(`/api/rooms/${id}/files/url`, { headers, data: { url: 'https://example.com/birds.mp3' } });

  await page.goto('/');
  await caption(page, 'A visitor opens the home page: they are asked for a room link, no rooms are listed');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ask for a room link');
  await expect(page.getByText(room)).toHaveCount(0);

  await caption(page, 'They open the link the staff gave them');
  await page.goto(`/rooms/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room);

  await caption(page, 'The room page has no link to other rooms');
  await expect(page.getByRole('link')).toHaveCount(0);

  await caption(page, 'Refreshing the page reopens the same room');
  await page.reload();
  await expect(page).toHaveURL(`/rooms/${id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room);
  await caption(page, `Still in "${room}"`, 2500);
});
