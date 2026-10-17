import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { migrateUp } from '../db/migrate.js';
import * as schema from '../db/schema.js';
import { Presence } from '../presence.js';
import { LocalDiskStorage } from '../storage/local.js';

const MISSING = '00000000-0000-0000-0000-000000000000';

describe('layer routes', () => {
  let app: FastifyInstance;
  let presence: Presence;

  beforeEach(async () => {
    const db: Db = drizzle(new PGlite(), { schema });
    await migrateUp(db);
    const dir = await mkdtemp(path.join(tmpdir(), 'music-room-'));
    presence = new Presence();
    app = await buildApp({ db, storage: new LocalDiskStorage(dir), maxUploadBytes: 1000, presence });
  });

  afterEach(() => app.close());

  // A room with `count` external-URL tracks named track-1 ... track-N.
  async function createRoom(count: number) {
    const room = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'Forest' } })).json();
    const trackIds: string[] = [];
    for (let i = 1; i <= count; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/files/url`,
        payload: { url: `https://example.com/track-${i}.mp3` },
      });
      trackIds.push(res.json().id);
    }
    return { roomId: room.id as string, trackIds };
  }

  const layer = (roomId: string, payload: unknown) =>
    app.inject({ method: 'POST', url: `/api/rooms/${roomId}/layer`, payload: payload as object });
  const assign = async (roomId: string, deviceId: string, previousTrackId?: string) =>
    (await layer(roomId, { deviceId, previousTrackId })).json().track.id as string;
  const tally = (ids: string[]) => {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  };

  it('returns the track id, display name and playable URL, and records the device as present', async () => {
    const { roomId, trackIds } = await createRoom(1);
    const res = await layer(roomId, { deviceId: 'phone-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ track: { id: trackIds[0], name: 'track-1', url: `/api/files/${trackIds[0]}` } });
    expect(presence.present(roomId)).toMatchObject([{ deviceId: 'phone-1', trackId: trackIds[0] }]);
  });

  it('gives N devices N different tracks', async () => {
    const { roomId, trackIds } = await createRoom(5);
    const assigned = [];
    for (let i = 0; i < 5; i++) assigned.push(await assign(roomId, `phone-${i}`));
    expect([...assigned].sort()).toEqual([...trackIds].sort());
  });

  it('spreads devices beyond N over the least-used tracks', async () => {
    const { roomId, trackIds } = await createRoom(3);
    const assigned = [];
    for (let i = 0; i < 8; i++) {
      assigned.push(await assign(roomId, `phone-${i}`));
      const counts = trackIds.map((id) => tally(assigned).get(id) ?? 0);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });

  it('never gives a device the track it just played', async () => {
    const { roomId } = await createRoom(3);
    for (let i = 0; i < 20; i++) {
      const previous = await assign(roomId, 'phone-1');
      expect(await assign(roomId, 'phone-1', previous)).not.toBe(previous);
    }
  });

  it('falls back to the device’s current track when no previous track is given', async () => {
    const { roomId } = await createRoom(2);
    const first = await assign(roomId, 'phone-1');
    expect(await assign(roomId, 'phone-1')).not.toBe(first);
  });

  it('repeats the only track of a one-track room', async () => {
    const { roomId, trackIds } = await createRoom(1);
    expect(await assign(roomId, 'phone-1', trackIds[0])).toBe(trackIds[0]);
  });

  it('returns a clear no-tracks response for an empty room', async () => {
    const { roomId } = await createRoom(0);
    const res = await layer(roomId, { deviceId: 'phone-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ track: null, reason: 'no-tracks', message: 'This room has no tracks yet' });
  });

  it('keeps the spread even with 100 devices in one room', async () => {
    const { roomId, trackIds } = await createRoom(7);
    const ids = Array.from({ length: 100 }, (_, i) => `phone-${i}`);
    await Promise.all(ids.map((id) => layer(roomId, { deviceId: id })));
    const spread = () => {
      const counts = tally(presence.present(roomId).map((d) => d.trackId!));
      return trackIds.map((id) => counts.get(id) ?? 0);
    };
    expect(Math.max(...spread()) - Math.min(...spread())).toBeLessThanOrEqual(1);

    // Devices move on to their next layer: each gets a track that is least used among the other
    // devices, excluding its own previous one. The no-repeat rule wins over balance (a device on
    // the least-used track must still leave it), so the spread itself is not asserted here.
    for (let round = 0; round < 3; round++) {
      for (const id of ids) {
        const others = presence.present(roomId).filter((d) => d.deviceId !== id);
        const previous = presence.present(roomId).find((d) => d.deviceId === id)!.trackId!;
        const counts = tally(others.map((d) => d.trackId!));
        const allowed = trackIds.filter((t) => t !== previous).map((t) => counts.get(t) ?? 0);
        const next = await assign(roomId, id, previous);
        expect(next).not.toBe(previous);
        expect(counts.get(next) ?? 0).toBe(Math.min(...allowed));
      }
    }
    expect(spread().reduce((a, b) => a + b)).toBe(100);
  });

  it('returns 404 for unknown and malformed room ids', async () => {
    for (const room of [MISSING, 'not-a-uuid']) {
      const res = await layer(room, { deviceId: 'phone-1' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Room not found' });
    }
  });

  it('rejects invalid device and previous track ids', async () => {
    const { roomId } = await createRoom(1);
    expect((await layer(roomId, {})).statusCode).toBe(400);
    expect((await layer(roomId, { deviceId: 'a/b' })).statusCode).toBe(400);
    expect((await layer(roomId, { deviceId: 'phone-1', previousTrackId: 'nope' })).statusCode).toBe(400);
  });
});
