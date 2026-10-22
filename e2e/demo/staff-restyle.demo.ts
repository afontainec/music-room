import { expect } from '@playwright/test';
import { adminHeaders, STAFF } from '../admin';
import { caption, click, test, typeInto } from './screencast';

// Phone size, as in the mockups; the video size is fixed when the page opens.
const phone = { width: 393, height: 851 };
test.use({ viewport: phone, video: { mode: 'on', size: phone } });

test('The staff login and room list in the dark style', async ({ page }) => {
  const suffix = Math.random().toString(36).slice(2, 6);
  const headers = await adminHeaders(page.request);
  await page.request.post('/api/rooms', { headers, data: { name: `Ocean ${suffix}`, colour: '#7fa8e0' } });
  await page.request.post('/api/rooms', { headers, data: { name: `Night rain ${suffix}`, colour: '#a99be0' } });

  await page.goto('/admin/login');
  await caption(page, 'The staff login now uses the dark style: Geist type, the form on a card', 3000);
  await typeInto(page, page.getByLabel('Username'), STAFF.username);
  await caption(page, 'Fields are raised on the card; the keyboard moves between them with a clear outline');
  await page.keyboard.press('Tab');
  await page.keyboard.type(STAFF.password, { delay: 70 });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Log in' })).toBeFocused();
  await page.waitForTimeout(1000);
  await caption(page, 'Enter on the "Log in" button signs staff in');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/admin');

  await caption(page, 'The staff area: the create form and the room list, each on a card', 3000);
  const forest = `Forest ${suffix}`;
  await click(page, page.getByRole('radio', { name: 'Moss' }));
  await typeInto(page, page.getByLabel('New room name'), forest);
  await click(page, page.getByRole('button', { name: 'Create room' }));

  const rooms = page.getByRole('list', { name: 'Rooms' });
  const row = rooms.getByRole('link', { name: forest, exact: true });
  await row.scrollIntoViewIfNeeded();
  await caption(page, 'Every room shows its colour as a dot, with the colour named beside it', 3500);
  await expect(row.locator('.staff-room-dot')).toHaveCSS('background-color', 'rgb(127, 191, 149)');
  await expect(row).toHaveAccessibleDescription('Moss');
  await expect(rooms.getByRole('link', { name: `Ocean ${suffix}`, exact: true })).toContainText('Sky');
});
