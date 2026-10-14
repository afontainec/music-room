import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { audio, createRoomWithTracks, enterRoom, expectPlaying } from './room';

const heading = (page: Page) => page.getByRole('heading', { level: 1 });

// The room's player is shown with one of the room's own tracks loaded.
async function expectRoomPlayer(page: Page, room: { name: string; tracks: { id: string }[] }) {
  await expect(heading(page)).toHaveText(room.name);
  await expect(audio(page)).toHaveAttribute('data-track-id', new RegExp(room.tracks.map((t) => t.id).join('|')));
}

test('Selecting a room updates the URL to a room-specific address', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 2);
  await enterRoom(page, room.name);
  await expect(page).toHaveURL(`/rooms/${room.id}`);
  await expectRoomPlayer(page, room);
  await expectPlaying(page);
});

test("Refreshing that URL loads the same room's player view", async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 2);
  await enterRoom(page, room.name);
  await expect(page).toHaveURL(`/rooms/${room.id}`);
  await page.reload();
  await expect(page).toHaveURL(`/rooms/${room.id}`);
  await expectRoomPlayer(page, room);
});

test('Opening that URL directly in a new tab loads the same room', async ({ page, context, request }) => {
  const room = await createRoomWithTracks(request, 2);
  await enterRoom(page, room.name);
  const tab = await context.newPage();
  await tab.goto(page.url());
  await expect(tab).toHaveURL(`/rooms/${room.id}`);
  await expectRoomPlayer(tab, room);
});

test.describe("An unknown or deleted room ID shows the room selection page with a 'room not found' message", () => {
  test('unknown room ID', async ({ page, request }) => {
    const other = await createRoomWithTracks(request, 0);
    await page.goto(`/rooms/${randomUUID()}`);
    await expect(heading(page)).toHaveText('Choose a room');
    await expect(page.getByRole('alert')).toContainText('Room not found');
    await expect(audio(page)).toHaveCount(0);
    // The visitor can pick another room from here.
    await page.getByRole('link', { name: other.name, exact: true }).click();
    await expect(page).toHaveURL(`/rooms/${other.id}`);
    await expect(heading(page)).toHaveText(other.name);
  });

  test('malformed room ID', async ({ page }) => {
    await page.goto('/rooms/not-a-room');
    await expect(heading(page)).toHaveText('Choose a room');
    await expect(page.getByRole('alert')).toContainText('Room not found');
  });

  test('deleted room ID', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1);
    await enterRoom(page, room.name);
    // There is no room delete endpoint yet, so deletion is simulated by the API answering
    // for this room the way it does for a missing one.
    await page.route(`/api/rooms/${room.id}**`, (route) =>
      route.fulfill({ status: 404, json: { error: 'Room not found' } }),
    );
    await page.route('/api/rooms', async (route) => {
      const res = await route.fetch();
      const rooms = (await res.json()) as { id: string }[];
      await route.fulfill({ response: res, json: rooms.filter((r) => r.id !== room.id) });
    });
    await page.reload();
    await expect(page).toHaveURL(`/rooms/${room.id}`);
    await expect(heading(page)).toHaveText('Choose a room');
    await expect(page.getByRole('alert')).toContainText('Room not found');
    await expect(page.getByRole('link', { name: room.name, exact: true })).toHaveCount(0);
  });
});

test('The browser back button returns to the room list', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1);
  await enterRoom(page, room.name);
  await expectPlaying(page);
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(heading(page)).toHaveText('Choose a room');
  await expect(page.getByRole('link', { name: room.name, exact: true })).toBeVisible();
  // Leaving the room stops its player.
  await expect(audio(page)).toHaveCount(0);
  // Forward reopens the same room.
  await page.goForward();
  await expect(page).toHaveURL(`/rooms/${room.id}`);
  await expect(heading(page)).toHaveText(room.name);
});
