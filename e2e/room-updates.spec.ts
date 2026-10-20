import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { adminHeaders, asStaff } from './admin';
import { audio, createRoomWithTracks, enterRoom, expectPlaying } from './room';

// There is no push transport: the selection page polls the room list every 5 s and the room page
// learns of renames and deletion from its heartbeat, every 10 s. These bounds add some slack.
const LIST_UPDATE_MS = 8_000;
const ROOM_UPDATE_MS = 14_000;

const roomList = (page: Page) => page.getByRole('list', { name: 'Rooms' });
const heading = (page: Page) => page.getByRole('heading', { level: 1 });

// A marker on window survives re-renders and client-side navigation but not a reload.
const markPage = (page: Page) => page.evaluate(() => ((window as unknown as { marker: boolean }).marker = true));
const stillSamePage = (page: Page) => page.evaluate(() => (window as unknown as { marker?: boolean }).marker === true);

// Uncaught errors and console errors on the page. The browser also logs the one request that
// discovers the deletion (the heartbeat's or layer request's 404) as a failed resource load;
// that is the signal itself, so it is left out.
function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    if (/Failed to load resource: the server responded with a status of 404/.test(msg.text())) return;
    errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

async function deleteRoom(page: Page, id: string) {
  const res = await page.request.delete(`/api/rooms/${id}`, { headers: await adminHeaders(page.request) });
  expect(res.status()).toBe(204);
}

async function renameRoom(page: Page, id: string, name: string) {
  const res = await page.request.patch(`/api/rooms/${id}`, { headers: await adminHeaders(page.request), data: { name } });
  expect(res.status()).toBe(200);
}

test('Deleting a room removes it from the public room selection page immediately', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1);
  const other = await createRoomWithTracks(request, 1);
  await asStaff(page);
  await page.goto('/');
  await expect(roomList(page).getByRole('link', { name: room.name, exact: true })).toBeVisible();
  await markPage(page);

  await deleteRoom(page, room.id);
  await expect(roomList(page).getByRole('link', { name: room.name, exact: true })).toHaveCount(0, {
    timeout: LIST_UPDATE_MS,
  });
  await expect(roomList(page).getByRole('link', { name: other.name, exact: true })).toBeVisible();
  expect(await stillSamePage(page)).toBe(true);
});

test('A listener currently in a deleted room sees a friendly message and a button back to room selection; no console errors or dead silence', async ({
  page,
  request,
}) => {
  const room = await createRoomWithTracks(request, 2);
  const errors = collectErrors(page);
  await enterRoom(page, room.name);
  await expectPlaying(page);
  await page.evaluate(() => {
    (window as unknown as { previousAudio: HTMLAudioElement }).previousAudio = document.querySelector('audio')!;
  });

  await deleteRoom(page, room.id);
  await expect(heading(page)).toHaveText('This room has closed', { timeout: ROOM_UPDATE_MS });
  await expect(page.getByRole('status')).toContainText('removed this room');
  // The player is gone and its audio stopped, rather than a silent player left on screen.
  await expect(audio(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { previousAudio: HTMLAudioElement }).previousAudio.paused),
  ).toBe(true);
  await expect(page.getByText('This track could not be played')).toHaveCount(0);

  // The page stops asking about the room: no more heartbeats or layer requests.
  const roomRequests: string[] = [];
  page.on('request', (req) => req.url().includes(`/api/rooms/${room.id}`) && roomRequests.push(req.url()));
  await page.waitForTimeout(11_000);
  expect(roomRequests).toEqual([]);

  const back = page.getByRole('button', { name: 'Back to room selection' });
  await back.click();
  await expect(page).toHaveURL('/');
  await expect(heading(page)).toHaveText('Choose a room');
  await expect(roomList(page).getByRole('link', { name: room.name, exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Renaming a room updates the displayed name on the selection list and in the open room page without interrupting the audio element', async ({
  page,
  request,
}) => {
  const room = await createRoomWithTracks(request, 2, 60);
  const newName = `${room.name}-renamed`;
  const list = await page.context().newPage();
  await asStaff(list);
  await list.goto('/');
  await expect(roomList(list).getByRole('link', { name: room.name, exact: true })).toBeVisible();

  await enterRoom(page, room.name);
  await expectPlaying(page);
  // Watch the element for anything that would restart or cut the audio.
  const trackId = await page.evaluate(() => {
    const el = document.querySelector('audio')!;
    const w = window as unknown as { originalAudio: HTMLAudioElement; interruptions: string[] };
    w.originalAudio = el;
    w.interruptions = [];
    for (const type of ['emptied', 'loadstart', 'pause', 'ended', 'abort']) {
      el.addEventListener(type, () => w.interruptions.push(type));
    }
    return el.dataset.trackId!;
  });
  const before = await audio(page).evaluate((a: HTMLAudioElement) => a.currentTime);

  await renameRoom(page, room.id, newName);
  await expect(roomList(list).getByRole('link', { name: newName, exact: true })).toBeVisible({ timeout: LIST_UPDATE_MS });
  await expect(roomList(list).getByRole('link', { name: room.name, exact: true })).toHaveCount(0);
  await expect(heading(page)).toHaveText(newName, { timeout: ROOM_UPDATE_MS });

  const after = await page.evaluate(() => {
    const w = window as unknown as { originalAudio: HTMLAudioElement; interruptions: string[] };
    const el = document.querySelector('audio')!;
    return {
      same: el === w.originalAudio,
      paused: el.paused,
      time: el.currentTime,
      trackId: el.dataset.trackId,
      interruptions: w.interruptions,
    };
  });
  expect(after).toMatchObject({ same: true, paused: false, trackId, interruptions: [] });
  expect(after.time).toBeGreaterThan(before);
  // The player's lock-screen metadata follows the new name too.
  expect(await page.evaluate(() => navigator.mediaSession.metadata?.album)).toBe(newName);
});

test('Updates arrive by short-interval polling, and at once when the page returns to view', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1);
  const newName = `${room.name}-back`;
  const list = await page.context().newPage();
  await asStaff(list);
  await list.goto('/');
  await expect(roomList(list).getByRole('link', { name: room.name, exact: true })).toBeVisible();
  await page.goto(`/rooms/${room.id}`);
  await expect(heading(page)).toHaveText(room.name);
  // Let the first heartbeat round pass, so the next scheduled one is seconds away.
  await page.waitForTimeout(1_000);

  await renameRoom(page, room.id, newName);
  const start = Date.now();
  for (const p of [page, list]) {
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  }
  await expect(heading(page)).toHaveText(newName, { timeout: 3_000 });
  await expect(roomList(list).getByRole('link', { name: newName, exact: true })).toBeVisible({ timeout: 3_000 });
  expect(Date.now() - start).toBeLessThan(4_000);
});
