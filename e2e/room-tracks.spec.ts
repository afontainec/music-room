import { expect, test } from '@playwright/test';
import { adminHeaders } from './admin';
import { silentMp3 } from './mp3';
import { createRoomWithTracks } from './room';

interface ListedTrack {
  id: string;
  name: string;
  url: string;
}

// Adding tracks needs a staff session; the listing is public.
test('A request for a room’s tracks returns every track of that room, with id, name and playable URL', async ({
  page,
  request,
}) => {
  const room = await createRoomWithTracks(request, 2);
  const linked = await request.post(`/api/rooms/${room.id}/files/url`, {
    headers: await adminHeaders(request),
    data: { url: 'https://example.com/sounds/wind.mp3' },
  });
  expect(linked.status()).toBe(201);
  const ids = [...room.tracks.map((t) => t.id), (await linked.json()).id];

  const res = await request.get(`/api/rooms/${room.id}/files`);
  expect(res.status()).toBe(200);
  const tracks = (await res.json()) as ListedTrack[];
  expect(tracks.map((t) => t.id).sort()).toEqual([...ids].sort());
  for (const t of tracks) expect(t).toMatchObject({ id: expect.any(String), name: expect.any(String), url: `/api/files/${t.id}` });

  // The URL plays in a browser audio element as is (muted, so autoplay is allowed).
  const uploaded = tracks.find((t) => t.id === room.tracks[0]!.id)!;
  await page.goto('/');
  await page.setContent(`<p>${uploaded.name}</p><audio controls muted autoplay src="${uploaded.url}"></audio>`);
  const audio = page.locator('audio');
  await expect
    .poll(() => audio.evaluate((a: HTMLAudioElement) => !a.paused && a.currentTime > 0.2), { timeout: 10_000 })
    .toBe(true);
  expect(new URL(await audio.evaluate((a: HTMLAudioElement) => a.currentSrc)).pathname).toBe(uploaded.url);
});

test('Track names match the uploaded file name without the extension', async ({ request }) => {
  const room = await createRoomWithTracks(request, 0);
  const headers = await adminHeaders(request);
  const up = await request.post(`/api/rooms/${room.id}/files`, {
    headers,
    multipart: { file: { name: 'Forest Birds.mp3', mimeType: 'audio/mpeg', buffer: silentMp3(1) } },
  });
  expect(up.status()).toBe(201);
  await request.post(`/api/rooms/${room.id}/files/url`, {
    headers,
    data: { url: 'https://example.com/a/water-stream.mp3' },
  });

  const tracks = (await (await request.get(`/api/rooms/${room.id}/files`)).json()) as ListedTrack[];
  expect(tracks.map((t) => t.name).sort()).toEqual(['Forest Birds', 'water-stream']);
});

test('A room with no tracks returns an empty list, not an error', async ({ request }) => {
  const room = await createRoomWithTracks(request, 0);
  const res = await request.get(`/api/rooms/${room.id}/files`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual([]);
});

test('An unknown room id returns a 404', async ({ request }) => {
  expect((await request.get(`/api/rooms/${crypto.randomUUID()}/files`)).status()).toBe(404);
  expect((await request.get('/api/rooms/not-a-room/files')).status()).toBe(404);
});

test('Tracks of other rooms are never included', async ({ request }) => {
  const mine = await createRoomWithTracks(request, 1);
  const other = await createRoomWithTracks(request, 2);
  const tracks = (await (await request.get(`/api/rooms/${mine.id}/files`)).json()) as ListedTrack[];
  expect(tracks.map((t) => t.id)).toEqual([mine.tracks[0]!.id]);
  for (const t of other.tracks) expect(tracks.map((x) => x.id)).not.toContain(t.id);
});
