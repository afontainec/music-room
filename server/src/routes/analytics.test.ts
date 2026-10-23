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
import { usageEvents } from '../db/schema.js';
import { LocalDiskStorage } from '../storage/local.js';
import { adminHeaders, testAuth } from '../test/admin.js';
import { parseBound } from './analytics.js';

const auth = testAuth();
const admin = adminHeaders(auth);

const MISSING = '00000000-0000-0000-0000-000000000000';

describe('analytics routes', () => {
  let app: FastifyInstance;
  let db: Db;

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrateUp(db);
    const dir = await mkdtemp(path.join(tmpdir(), 'music-room-'));
    app = await buildApp({ db, storage: new LocalDiskStorage(dir), maxUploadBytes: 1000, auth });
  });

  afterEach(() => app.close());

  async function createRoom(name: string, tracks = 1) {
    const room = (await app.inject({ method: 'POST', url: '/api/rooms', headers: admin, payload: { name } })).json();
    const trackIds: string[] = [];
    for (let i = 1; i <= tracks; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/files/url`,
        headers: admin,
        payload: { url: `https://example.com/${name}-${i}.mp3` },
      });
      trackIds.push(res.json().id);
    }
    return { id: room.id as string, colour: room.colour as string, trackIds };
  }

  const visit = (roomId: string, payload: unknown) =>
    app.inject({ method: 'POST', url: `/api/rooms/${roomId}/visits`, payload: payload as object });
  const play = (roomId: string, payload: unknown) =>
    app.inject({ method: 'POST', url: `/api/rooms/${roomId}/plays`, payload: payload as object });
  const report = (query = '') => app.inject({ method: 'GET', url: `/api/analytics/rooms${query}`, headers: admin });

  describe('logging a room visit', () => {
    it('records the visit with a timestamp', async () => {
      const room = await createRoom('Forest');
      const before = Date.now();
      const res = await visit(room.id, { deviceId: 'phone-1' });
      expect(res.statusCode).toBe(204);
      const events = await db.select().from(usageEvents);
      expect(events).toMatchObject([{ type: 'visit', roomId: room.id, trackId: null, deviceId: 'phone-1' }]);
      expect(events[0].occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(events[0].occurredAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('returns 404 for unknown and malformed rooms', async () => {
      for (const id of [MISSING, 'not-a-uuid']) {
        const res = await visit(id, { deviceId: 'phone-1' });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ error: 'Room not found' });
      }
      expect(await db.select().from(usageEvents)).toHaveLength(0);
    });

    it('rejects a missing or invalid device id', async () => {
      const room = await createRoom('Forest');
      expect((await visit(room.id, {})).statusCode).toBe(400);
      expect((await visit(room.id, { deviceId: 'a/b' })).statusCode).toBe(400);
    });

    it('needs no staff token', async () => {
      const room = await createRoom('Forest');
      expect((await visit(room.id, { deviceId: 'phone-1' })).statusCode).toBe(204);
    });
  });

  describe('logging a track play', () => {
    it('records the play with its track and a timestamp', async () => {
      const room = await createRoom('Forest');
      const res = await play(room.id, { deviceId: 'phone-1', trackId: room.trackIds[0] });
      expect(res.statusCode).toBe(204);
      const events = await db.select().from(usageEvents);
      expect(events).toMatchObject([{ type: 'play', roomId: room.id, trackId: room.trackIds[0], deviceId: 'phone-1' }]);
      expect(events[0].occurredAt).toBeInstanceOf(Date);
    });

    it('returns 404 for an unknown room or a track of another room', async () => {
      const forest = await createRoom('Forest');
      const beach = await createRoom('Beach');
      expect((await play(MISSING, { deviceId: 'phone-1', trackId: forest.trackIds[0] })).statusCode).toBe(404);
      const res = await play(forest.id, { deviceId: 'phone-1', trackId: beach.trackIds[0] });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Track not found in this room' });
      expect(await db.select().from(usageEvents)).toHaveLength(0);
    });

    it('rejects missing or invalid ids', async () => {
      const room = await createRoom('Forest');
      expect((await play(room.id, { trackId: room.trackIds[0] })).statusCode).toBe(400);
      expect((await play(room.id, { deviceId: 'phone-1' })).statusCode).toBe(400);
      expect((await play(room.id, { deviceId: 'phone-1', trackId: 'nope' })).statusCode).toBe(400);
    });
  });

  describe('the report', () => {
    it('returns visit, visitor and play counts per room, with zeros for rooms without events', async () => {
      const forest = await createRoom('Forest', 2);
      const beach = await createRoom('Beach');
      const empty = await createRoom('Attic', 0);
      await visit(forest.id, { deviceId: 'phone-1' });
      await visit(forest.id, { deviceId: 'phone-1' });
      await visit(forest.id, { deviceId: 'phone-2' });
      await play(forest.id, { deviceId: 'phone-1', trackId: forest.trackIds[0] });
      await play(forest.id, { deviceId: 'phone-1', trackId: forest.trackIds[1] });
      await play(beach.id, { deviceId: 'phone-3', trackId: beach.trackIds[0] });

      const res = await report();
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        from: null,
        to: null,
        rooms: [
          { id: empty.id, name: 'Attic', colour: empty.colour, visits: 0, visitors: 0, plays: 0 },
          { id: beach.id, name: 'Beach', colour: beach.colour, visits: 0, visitors: 0, plays: 1 },
          { id: forest.id, name: 'Forest', colour: forest.colour, visits: 3, visitors: 2, plays: 2 },
        ],
      });
    });

    it('returns an empty list when there are no rooms', async () => {
      expect((await report()).json()).toEqual({ from: null, to: null, rooms: [] });
    });

    it('filters by date range in UTC, from inclusive and a date-only to including that day', async () => {
      const room = await createRoom('Forest');
      const at = (iso: string) => ({ roomId: room.id, deviceId: 'phone-1', occurredAt: new Date(iso) });
      await db.insert(usageEvents).values([
        { type: 'visit', ...at('2026-10-01T00:00:00Z') },
        { type: 'visit', ...at('2026-10-01T23:59:59Z') },
        { type: 'play', trackId: room.trackIds[0], ...at('2026-10-02T12:00:00Z') },
        { type: 'visit', ...at('2026-10-03T00:00:00Z') },
      ]);
      const counts = async (query: string) => {
        const res = await report(query);
        expect(res.statusCode).toBe(200);
        const { visits, plays } = res.json().rooms[0];
        return { visits, plays };
      };

      expect(await counts('?from=2026-10-01&to=2026-10-01')).toEqual({ visits: 2, plays: 0 });
      expect(await counts('?from=2026-10-02&to=2026-10-02')).toEqual({ visits: 0, plays: 1 });
      expect(await counts('?from=2026-10-02')).toEqual({ visits: 1, plays: 1 });
      expect(await counts('?to=2026-10-02')).toEqual({ visits: 2, plays: 1 });
      expect(await counts('?from=2026-10-01T12:00:00Z&to=2026-10-03T00:00:00Z')).toEqual({ visits: 1, plays: 1 });
      // An offset is honoured: 2026-10-02T02:00+02:00 is midnight UTC.
      expect(await counts('?from=2026-10-02T02:00:00%2B02:00')).toEqual({ visits: 1, plays: 1 });
      expect(await counts('?from=2025-01-01&to=2025-12-31')).toEqual({ visits: 0, plays: 0 });
    });

    it('echoes the range it applied as UTC instants', async () => {
      const res = await report('?from=2026-10-01&to=2026-10-31');
      expect(res.json()).toMatchObject({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' });
    });

    it('rejects invalid ranges', async () => {
      for (const query of [
        '?from=yesterday',
        '?from=2026-02-31',
        '?to=2026-10-01T10:00:00', // no offset
        '?from=2026-10-02&to=2026-10-01',
      ]) {
        const res = await report(query);
        expect(res.statusCode, query).toBe(400);
        expect(res.json().error).toEqual(expect.any(String));
      }
    });

    it('needs a staff token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/analytics/rooms' });
      expect(res.statusCode).toBe(401);
    });

    it('keeps the plays of a removed track and drops a deleted room', async () => {
      const forest = await createRoom('Forest');
      const beach = await createRoom('Beach');
      await play(forest.id, { deviceId: 'phone-1', trackId: forest.trackIds[0] });
      await visit(beach.id, { deviceId: 'phone-1' });
      await app.inject({ method: 'DELETE', url: `/api/files/${forest.trackIds[0]}`, headers: admin });
      await app.inject({ method: 'DELETE', url: `/api/rooms/${beach.id}`, headers: admin });
      expect((await report()).json().rooms).toMatchObject([{ name: 'Forest', plays: 1 }]);
    });
  });
});

describe('parseBound', () => {
  it('reads dates as UTC days and date-times with their offset', () => {
    expect(parseBound('2026-10-22', 'from')?.toISOString()).toBe('2026-10-22T00:00:00.000Z');
    expect(parseBound('2026-10-22', 'to')?.toISOString()).toBe('2026-10-23T00:00:00.000Z');
    expect(parseBound('2026-10-22T09:30Z', 'to')?.toISOString()).toBe('2026-10-22T09:30:00.000Z');
    expect(parseBound('2026-10-22T09:30:00-03:00', 'from')?.toISOString()).toBe('2026-10-22T12:30:00.000Z');
    expect(parseBound(undefined, 'from')).toBeUndefined();
    expect(parseBound('', 'from')).toBeUndefined();
  });

  it('rejects anything else', () => {
    for (const value of ['2026-13-01', '2026-02-29', '22/10/2026', '2026-10-22T09:30', 'now', ['2026-10-22']]) {
      expect(parseBound(value, 'from'), String(value)).toBeNull();
    }
  });
});
