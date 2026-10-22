import { expect } from '@playwright/test';
import { adminHeaders, asStaff } from '../admin';
import { caption, click, test } from './screencast';

// Phone size, as in the mockups (see room-selection-restyle.demo.ts for why it is set here).
const phone = { width: 393, height: 851 };
test.use({ viewport: phone, video: { mode: 'on', size: phone } });

test("Each room's colour on its card and on the room page", async ({ page }) => {
  const suffix = Math.random().toString(36).slice(2, 6);
  const headers = await adminHeaders(page.request);
  const create = async (name: string, colour: string) => {
    const res = await page.request.post('/api/rooms', { headers, data: { name, colour } });
    return ((await res.json()) as { id: string }).id;
  };
  const ocean = `Ocean ${suffix}`;
  const oceanId = await create(ocean, '#7fa8e0');
  await create(`Desert ${suffix}`, '#e0ae7f');
  await create(`Night rain ${suffix}`, '#a99be0');

  await asStaff(page);
  await page.goto('/');
  await caption(page, 'Each room card glows in the room’s own colour', 3000);

  await caption(page, `Open "${ocean}", a blue room`);
  await click(page, page.getByRole('link', { name: ocean, exact: true }));
  const inner = page.locator('.room-ring-inner');
  await expect(inner).toHaveCSS('stroke', 'rgb(127, 168, 224)');
  await caption(page, 'The inner ring, centre dot and glow take the same blue', 3000);

  await caption(page, 'Meanwhile staff change the room’s colour to coral…', 2000);
  await page.request.patch(`/api/rooms/${oceanId}`, { headers, data: { colour: '#e08a84' } });
  await caption(page, '…and a reload of the room page shows coral, no server restart', 2000);
  await page.reload();
  await expect(inner).toHaveCSS('stroke', 'rgb(224, 138, 132)');
  await caption(page, 'The room is now coral', 3000);
  await expect(page.locator('.room-ring-dot')).toHaveCSS('fill', 'rgb(224, 138, 132)');
});
