import { expect, test, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { asStaff } from './admin';
import { blockAutoplay, createRoomWithTracks, expectPlaying } from './room';

const qrCode = (page: Page) => page.getByRole('img', { name: /^QR code for / });

/** The text encoded in the QR code on the page, read from the canvas pixels as a phone camera would. */
async function decodeQr(page: Page) {
  const { data, width, height } = await qrCode(page).evaluate((canvas: HTMLCanvasElement) => {
    const image = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    return { data: Array.from(image.data), width: image.width, height: image.height };
  });
  return jsQR(Uint8ClampedArray.from(data), width, height)?.data ?? null;
}

test('When logged in as staff, the admin room page shows a link that opens that room’s QR code page', async ({
  page,
  request,
}) => {
  const room = await createRoomWithTracks(request, 1);
  await asStaff(page);
  await page.goto(`/admin/rooms/${room.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
  const link = page.getByRole('link', { name: 'QR code', exact: true });
  await expect(link).toHaveAttribute('href', `/admin/rooms/${room.id}/qrcode`);

  await link.click();
  await expect(page).toHaveURL(`/admin/rooms/${room.id}/qrcode`);
  await expect(qrCode(page)).toBeVisible();
});

test('The QR code page shows a scannable QR code of the room’s public URL that opens the room for a visitor', async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  const room = await createRoomWithTracks(request, 1);
  await asStaff(page);
  await page.goto(`/admin/rooms/${room.id}/qrcode`);
  await expect(qrCode(page)).toBeVisible();
  await expect.poll(() => decodeQr(page)).toBe(`${baseURL}/rooms/${room.id}`);

  // A visitor (a fresh context, so no staff session) opens what the code encodes.
  const scanned = (await decodeQr(page))!;
  const visitor = await (await browser.newContext()).newPage();
  await blockAutoplay(visitor);
  await visitor.goto(scanned);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(room.name);
  await visitor.getByRole('button', { name: 'Tap to listen' }).click();
  await expectPlaying(visitor);
  await visitor.context().close();
});

test('The room’s full public URL is displayed as text on the page', async ({ page, request, baseURL }) => {
  const room = await createRoomWithTracks(request, 1);
  await asStaff(page);
  await page.goto(`/admin/rooms/${room.id}/qrcode`);
  const url = `${baseURL}/rooms/${room.id}`;
  await expect(page.getByText(url, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: url, exact: true })).toHaveAttribute('href', url);
});

test('The room name is shown on the page', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1);
  await asStaff(page);
  await page.goto(`/admin/rooms/${room.id}/qrcode`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
});

test('Non-authenticated users cannot access the QR code page and are redirected to login', async ({
  page,
  request,
}) => {
  const room = await createRoomWithTracks(request, 1);
  await page.goto(`/admin/rooms/${room.id}/qrcode`);
  await expect(page).toHaveURL('/admin/login');
  await expect(qrCode(page)).toHaveCount(0);
  await expect(page.getByText(room.name)).toHaveCount(0);
});
