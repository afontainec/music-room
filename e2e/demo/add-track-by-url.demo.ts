import { expect } from '@playwright/test';
import { adminHeaders, asStaff } from '../admin';
import { caption, click, test, typeInto } from './screencast';

test('Staff add a track to a room by the URL of an externally hosted mp3', async ({ page }) => {
  // Set up a room the staff member opens from the staff area.
  const name = `Forest ${Date.now().toString(36).slice(-4)}`;
  const res = await page.request.post('/api/rooms', { headers: await adminHeaders(page.request), data: { name } });
  expect(res.status()).toBe(201);
  await asStaff(page);

  await page.goto('/admin');
  await caption(page, `Staff open the room "${name}" from the staff area`);
  await click(page, page.getByRole('link', { name, exact: true }));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

  await caption(page, 'Uploading a file is the default; they switch to "Add by URL"');
  await click(page, page.getByRole('radio', { name: 'Add by URL' }));
  const submit = page.getByRole('button', { name: 'Add track' });
  await expect(submit).toBeDisabled();

  await caption(page, 'A link that is not an mp3 is refused, with the reason');
  await typeInto(page, page.getByLabel('Mp3 URL'), 'https://cdn.example.com/birds.wav');
  await click(page, submit);
  await expect(page.getByRole('alert')).toHaveText('url must point to an .mp3 file');

  await caption(page, 'They paste the link to the mp3 and add it');
  await page.getByLabel('Mp3 URL').fill('');
  await typeInto(page, page.getByLabel('Mp3 URL'), 'https://cdn.example.com/forest/birds-at-dawn.mp3');
  await click(page, submit);

  await expect(page.getByRole('status')).toHaveText('Track added from the URL.');
  await expect(page.getByRole('list', { name: 'Tracks' })).toContainText('birds-at-dawn');
  await caption(page, 'The track is in the room’s list right away, no refresh needed', 3500);
});
