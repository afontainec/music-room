import { expect, test, type APIRequestContext } from '@playwright/test';
import { createRoomWithTracks } from './room';

// The room page plays what this endpoint assigns (soundscape.spec.ts); these cover its rules directly.
interface Layer {
  id: string;
  name: string;
  url: string;
}

async function layer(request: APIRequestContext, roomId: string, deviceId: string, previousTrackId?: string) {
  const res = await request.post(`/api/rooms/${roomId}/layer`, { data: { deviceId, previousTrackId } });
  expect(res.status()).toBe(200);
  return (await res.json()) as { track: Layer | null; reason?: string };
}

const assign = async (request: APIRequestContext, roomId: string, deviceId: string, previous?: string) =>
  (await layer(request, roomId, deviceId, previous)).track!.id;

const spread = (ids: string[], trackIds: string[]) => {
  const counts = trackIds.map((t) => ids.filter((id) => id === t).length);
  return Math.max(...counts) - Math.min(...counts);
};

test('Endpoint returns track id, display name and playable URL for a device joining a room', async ({
  request,
}) => {
  const room = await createRoomWithTracks(request, 1, 1);
  const { track } = await layer(request, room.id, 'phone-1');
  expect(track).toEqual({ id: room.tracks[0].id, name: 'track-1', url: `/api/files/${room.tracks[0].id}` });

  const audio = await request.get(track!.url);
  expect(audio.status()).toBe(200);
  expect(audio.headers()['content-type']).toBe('audio/mpeg');

  const presence = await (await request.get(`/api/rooms/${room.id}/presence`)).json();
  expect(presence.devices).toMatchObject([{ deviceId: 'phone-1', trackId: track!.id }]);
});

test('With N tracks and up to N devices present, every device gets a different track', async ({ request }) => {
  const room = await createRoomWithTracks(request, 4, 1);
  const assigned: string[] = [];
  for (let i = 0; i < 4; i++) {
    assigned.push(await assign(request, room.id, `phone-${i}`));
    expect(new Set(assigned).size).toBe(assigned.length);
  }
  expect([...assigned].sort()).toEqual(room.tracks.map((t) => t.id).sort());
});

test('Beyond N devices, assignment goes to least-used tracks, so no track plays on two devices before every track plays on one', async ({
  request,
}) => {
  const room = await createRoomWithTracks(request, 3, 1);
  const trackIds = room.tracks.map((t) => t.id);
  const assigned: string[] = [];
  for (let i = 0; i < 9; i++) {
    assigned.push(await assign(request, room.id, `phone-${i}`));
    expect(spread(assigned, trackIds)).toBeLessThanOrEqual(1);
  }
});

test('A device asking for its next layer never gets the track it just played, except in a one-track room', async ({
  request,
}) => {
  const room = await createRoomWithTracks(request, 3, 1);
  let previous = await assign(request, room.id, 'phone-1');
  for (let i = 0; i < 15; i++) {
    const next = await assign(request, room.id, 'phone-1', previous);
    expect(next).not.toBe(previous);
    previous = next;
  }

  const single = await createRoomWithTracks(request, 1, 1);
  const only = single.tracks[0].id;
  expect(await assign(request, single.id, 'phone-1', only)).toBe(only);
});

test('A room with no tracks returns a clear no-tracks response', async ({ request }) => {
  const room = await createRoomWithTracks(request, 0);
  expect(await layer(request, room.id, 'phone-1')).toEqual({
    track: null,
    reason: 'no-tracks',
    message: 'This room has no tracks yet',
  });
});

test('Assignment stays correct with 100 devices in one room', async ({ request }) => {
  const room = await createRoomWithTracks(request, 7, 1);
  const trackIds = room.tracks.map((t) => t.id);
  const ids = Array.from({ length: 100 }, (_, i) => `phone-${String(i).padStart(3, '0')}`);
  const joined = await Promise.all(ids.map((id) => assign(request, room.id, id)));
  expect(spread(joined, trackIds)).toBeLessThanOrEqual(1);

  // Every device asks for its next layer at once: none repeats, and all 100 stay present.
  const next = await Promise.all(ids.map((id, i) => assign(request, room.id, id, joined[i])));
  ids.forEach((_, i) => expect(next[i]).not.toBe(joined[i]));
  const presence = await (await request.get(`/api/rooms/${room.id}/presence`)).json();
  expect(presence.devices).toHaveLength(100);
});
