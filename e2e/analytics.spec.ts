import { expect, test, type APIRequestContext } from '@playwright/test';
import { adminHeaders } from './admin';
import { blockAutoplay, createRoomWithTracks, enterRoom, expectPlaying, playingTrackId } from './room';

interface RoomUsage {
  id: string;
  name: string;
  visits: number;
  visitors: number;
  plays: number;
}

async function report(request: APIRequestContext, query: Record<string, string> = {}) {
  const res = await request.get('/api/analytics/rooms', { headers: await adminHeaders(request), params: query });
  expect(res.status()).toBe(200);
  return (await res.json()) as { from: string | null; to: string | null; rooms: RoomUsage[] };
}

/** The room's counts in the report (the test database is shared, so look the room up by id). */
async function usage(request: APIRequestContext, roomId: string, query: Record<string, string> = {}) {
  const room = (await report(request, query)).rooms.find((r) => r.id === roomId);
  expect(room, 'every room is in the report').toBeDefined();
  return { visits: room!.visits, visitors: room!.visitors, plays: room!.plays };
}

const iso = (ms: number) => new Date(ms).toISOString();
const todayUtc = () => new Date().toISOString().slice(0, 10);

test.describe('System logs each room visit with timestamp', () => {
  test('entering a room records one visit, timestamped now', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1);
    const start = Date.now() - 1000;
    await enterRoom(page, room.name);
    await expectPlaying(page);

    const now = { from: iso(start), to: iso(Date.now() + 60_000) };
    await expect.poll(async () => (await usage(request, room.id, now)).visits).toBe(1);
    // The timestamp is the visit's: a range that ends before the test started does not count it.
    expect((await usage(request, room.id, { to: iso(start) })).visits).toBe(0);

    // Coming back to the room is another visit from the same device (tab).
    await page.reload();
    await expect.poll(async () => (await usage(request, room.id, now)).visits).toBe(2);
    expect((await usage(request, room.id, now)).visitors).toBe(1);
  });

  test('two devices are two visitors', async ({ browser, request }) => {
    const room = await createRoomWithTracks(request, 2);
    const contexts = [await browser.newContext(), await browser.newContext()];
    for (const context of contexts) await enterRoom(await context.newPage(), room.name);
    await expect.poll(async () => usage(request, room.id)).toMatchObject({ visits: 2, visitors: 2 });
    for (const context of contexts) await context.close();
  });
});

test.describe('System logs each track play event', () => {
  test('every layer that starts playing is one play', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    // Short tracks: the device moves on to its next layer and each start counts once.
    await expect.poll(async () => (await usage(request, room.id)).plays, { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
    await expectPlaying(page);
  });

  test('a layer counts as played only once it plays, not while autoplay is blocked', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1);
    await blockAutoplay(page);
    await page.goto(`/rooms/${room.id}`);
    const tap = page.getByRole('button', { name: 'Tap to listen' });
    await expect(tap).toBeVisible();
    await expect.poll(async () => (await usage(request, room.id)).visits).toBe(1);
    expect((await usage(request, room.id)).plays).toBe(0);

    await tap.click();
    expect(await playingTrackId(page)).toBe(room.tracks[0].id);
    await expect.poll(async () => (await usage(request, room.id)).plays).toBe(1);

    // Pausing and resuming the same layer is not another play.
    await page.locator('audio').evaluate((a: HTMLAudioElement) => a.pause());
    await page.locator('audio').evaluate((a: HTMLAudioElement) => a.play());
    await expectPlaying(page);
    await page.waitForTimeout(500);
    expect((await usage(request, room.id)).plays).toBe(1);
  });
});

test.describe('A query/report endpoint returns visit counts and play counts per room', () => {
  test('the report lists each room with its own visits and plays', async ({ request }) => {
    const forest = await createRoomWithTracks(request, 2);
    const beach = await createRoomWithTracks(request, 1);
    const empty = await createRoomWithTracks(request, 0);
    for (const deviceId of ['phone-1', 'phone-1', 'phone-2']) {
      expect((await request.post(`/api/rooms/${forest.id}/visits`, { data: { deviceId } })).status()).toBe(204);
    }
    for (const track of forest.tracks) {
      await request.post(`/api/rooms/${forest.id}/plays`, { data: { deviceId: 'phone-1', trackId: track.id } });
    }
    await request.post(`/api/rooms/${beach.id}/visits`, { data: { deviceId: 'phone-3' } });
    await request.post(`/api/rooms/${beach.id}/plays`, { data: { deviceId: 'phone-3', trackId: beach.tracks[0].id } });

    expect(await usage(request, forest.id)).toEqual({ visits: 3, visitors: 2, plays: 2 });
    expect(await usage(request, beach.id)).toEqual({ visits: 1, visitors: 1, plays: 1 });
    expect(await usage(request, empty.id)).toEqual({ visits: 0, visitors: 0, plays: 0 });
  });

  test('the report is for staff only and events must name a real room and track', async ({ request }) => {
    expect((await request.get('/api/analytics/rooms')).status()).toBe(401);
    const room = await createRoomWithTracks(request, 1);
    const other = await createRoomWithTracks(request, 1);
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await request.post(`/api/rooms/${missing}/visits`, { data: { deviceId: 'phone-1' } })).status()).toBe(404);
    const wrongTrack = { deviceId: 'phone-1', trackId: other.tracks[0].id };
    expect((await request.post(`/api/rooms/${room.id}/plays`, { data: wrongTrack })).status()).toBe(404);
    expect((await request.post(`/api/rooms/${room.id}/visits`, { data: {} })).status()).toBe(400);
  });
});

test.describe('Data is filterable by date range', () => {
  test('only events inside from/to (UTC) are counted', async ({ request }) => {
    const room = await createRoomWithTracks(request, 1);
    const before = Date.now() - 1000;
    await request.post(`/api/rooms/${room.id}/visits`, { data: { deviceId: 'phone-1' } });
    await request.post(`/api/rooms/${room.id}/plays`, { data: { deviceId: 'phone-1', trackId: room.tracks[0].id } });
    const after = Date.now() + 1000;

    expect(await usage(request, room.id, { from: iso(before), to: iso(after) })).toMatchObject({ visits: 1, plays: 1 });
    expect(await usage(request, room.id, { to: iso(before) })).toMatchObject({ visits: 0, plays: 0 });
    expect(await usage(request, room.id, { from: iso(after) })).toMatchObject({ visits: 0, plays: 0 });
    // A date-only range covers whole UTC days, both ends included.
    const today = todayUtc();
    expect(await usage(request, room.id, { from: today, to: today })).toMatchObject({ visits: 1, plays: 1 });
    expect(await usage(request, room.id, { from: '2000-01-01', to: '2000-12-31' })).toMatchObject({ visits: 0 });

    const applied = await report(request, { from: '2026-10-01', to: '2026-10-31' });
    expect(applied).toMatchObject({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' });
  });

  test('an invalid range is rejected', async ({ request }) => {
    const headers = await adminHeaders(request);
    for (const params of [{ from: 'last week' }, { to: '2026-10-01T10:00' }, { from: '2026-10-02', to: '2026-10-01' }]) {
      const res = await request.get('/api/analytics/rooms', { headers, params });
      expect(res.status(), JSON.stringify(params)).toBe(400);
    }
  });
});
