import { expect, test, type Page } from '@playwright/test';
import { asStaff, signToken, STAFF } from './admin';
import { audio, createRoomWithTracks, enterRoom, expectPlaying } from './room';

const TOKEN_KEY = 'music-room.staffToken';
const backLink = (page: Page) => page.getByRole('link', { name: '← All rooms' });

// A marker on window survives client-side navigation and re-renders but not a reload.
const markPage = (page: Page) => page.evaluate(() => ((window as unknown as { marker: boolean }).marker = true));
const stillSamePage = (page: Page) => page.evaluate(() => (window as unknown as { marker?: boolean }).marker === true);

test('Back button visible in room view only with a valid staff/admin session', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1);
  await asStaff(page);
  await page.goto(`/rooms/${room.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
  await expect(backLink(page)).toBeVisible();
  await expect(backLink(page)).toHaveAttribute('href', '/');
});

test('Clicking it opens the room selection page listing all rooms', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1);
  const other = await createRoomWithTracks(request, 1);
  await asStaff(page);
  await page.goto(`/rooms/${room.id}`);
  await backLink(page).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose a room');
  const list = page.getByRole('list', { name: 'Rooms' });
  await expect(list.getByRole('link', { name: room.name, exact: true })).toBeVisible();
  await expect(list.getByRole('link', { name: other.name, exact: true })).toBeVisible();
});

test('Button is not in the DOM for non-authenticated visitors', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1);
  const sessionChecks: string[] = [];
  page.on('request', (req) => req.url().includes('/api/auth/session') && sessionChecks.push(req.url()));

  await page.goto(`/rooms/${room.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(backLink(page)).toHaveCount(0);
  await expect(page.getByRole('link')).toHaveCount(0);
  expect(await page.content()).not.toContain('All rooms');
  // Without a token there is nothing to check, so visitors make no session requests.
  expect(sessionChecks).toEqual([]);

  // An invalid or expired token is no session either.
  await page.evaluate(([key, token]) => localStorage.setItem(key, token), [
    TOKEN_KEY,
    signToken({ sub: STAFF.username, exp: Date.now() - 1000 }),
  ] as const);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).toBeNull();
  await expect(backLink(page)).toHaveCount(0);
});

test('After staff logout or session expiry the button disappears without a reload', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1);

  // Logout: staff log out in the staff area in another tab while the room stays open.
  await asStaff(page);
  await page.goto(`/rooms/${room.id}`);
  await expect(backLink(page)).toBeVisible();
  await markPage(page);
  const staffTab = await page.context().newPage();
  await staffTab.goto('/admin');
  await staffTab.getByRole('button', { name: 'Log out' }).click();
  await expect(staffTab).toHaveURL('/admin/login');
  await expect(backLink(page)).toHaveCount(0);
  expect(await stillSamePage(page)).toBe(true);
  await staffTab.close();

  // Expiry: a session that runs out while the room is open.
  const expiring = await page.context().newPage();
  const expiresAt = Date.now() + 4_000;
  await expiring.addInitScript(([key, token]) => localStorage.setItem(key, token), [
    TOKEN_KEY,
    signToken({ sub: STAFF.username, exp: expiresAt }),
  ] as const);
  await expiring.goto(`/rooms/${room.id}`);
  await expect(backLink(expiring)).toBeVisible();
  await markPage(expiring);
  await expect(backLink(expiring)).toHaveCount(0, { timeout: 10_000 });
  expect(Date.now()).toBeGreaterThanOrEqual(expiresAt);
  expect(await stillSamePage(expiring)).toBe(true);
});

test('Navigating back does not leave audio from the previous room playing', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 2);
  await enterRoom(page, room.name);
  await expectPlaying(page);
  const deviceId = await page.evaluate(() => {
    const el = document.querySelector('audio')!;
    (window as unknown as { previousAudio: HTMLAudioElement }).previousAudio = el;
    return sessionStorage.getItem('music-room:device-id');
  });
  const presence = async () =>
    ((await (await request.get(`/api/rooms/${room.id}/presence`)).json()) as { devices: { deviceId: string }[] }).devices;
  expect((await presence()).map((d) => d.deviceId)).toContain(deviceId);

  await backLink(page).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('list', { name: 'Rooms' }).getByRole('link', { name: room.name, exact: true })).toBeVisible();
  await expect(audio(page)).toHaveCount(0);

  // The old element is detached and paused, and its position stays put.
  const state = () =>
    page.evaluate(() => {
      const el = (window as unknown as { previousAudio: HTMLAudioElement }).previousAudio;
      return { paused: el.paused, time: el.currentTime, attached: el.isConnected };
    });
  const before = await state();
  expect(before).toMatchObject({ paused: true, attached: false });
  await page.waitForTimeout(1_000);
  expect((await state()).time).toBe(before.time);
  // The device released its layer, so the room no longer counts it as present.
  await expect.poll(async () => (await presence()).map((d) => d.deviceId)).not.toContain(deviceId);
});
