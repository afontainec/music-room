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
const TRACK = '11111111-1111-1111-1111-111111111111';

describe('presence routes', () => {
  let app: FastifyInstance;
  let clock: number;
  let roomId: string;

  beforeEach(async () => {
    const db: Db = drizzle(new PGlite(), { schema });
    await migrateUp(db);
    const dir = await mkdtemp(path.join(tmpdir(), 'music-room-'));
    clock = 1_000_000;
    const presence = new Presence({ now: () => clock });
    app = await buildApp({ db, storage: new LocalDiskStorage(dir), maxUploadBytes: 1000, presence });
    roomId = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'Forest' } })).json().id;
  });

  afterEach(() => app.close());

  const heartbeat = (payload: unknown, room = roomId) =>
    app.inject({ method: 'POST', url: `/api/rooms/${room}/presence/heartbeat`, payload: payload as object });
  const present = async (room = roomId) =>
    (await app.inject({ method: 'GET', url: `/api/rooms/${room}/presence` })).json().devices;
  const leave = (deviceId: string, room = roomId) =>
    app.inject({ method: 'DELETE', url: `/api/rooms/${room}/presence/${deviceId}` });

  it('registers and refreshes a device on heartbeat', async () => {
    const res = await heartbeat({ deviceId: 'phone-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deviceId: 'phone-1', trackId: null, lastSeen: clock });

    clock += 10_000;
    await heartbeat({ deviceId: 'phone-1', trackId: TRACK });
    expect(await present()).toEqual([{ deviceId: 'phone-1', trackId: TRACK, lastSeen: clock }]);
  });

  it('drops a device 30 seconds after its last heartbeat', async () => {
    await heartbeat({ deviceId: 'phone-1' });
    clock += 29_999;
    expect(await present()).toHaveLength(1);
    clock += 1;
    expect(await present()).toEqual([]);
  });

  it('removes a device immediately on leave', async () => {
    await heartbeat({ deviceId: 'phone-1' });
    expect((await leave('phone-1')).statusCode).toBe(204);
    expect(await present()).toEqual([]);
  });

  it('returns 404 when leaving with an unknown device id', async () => {
    const res = await leave('nobody');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Device not present in this room' });
  });

  it('returns 404 for unknown and malformed room ids', async () => {
    for (const room of [MISSING, 'not-a-uuid']) {
      expect((await heartbeat({ deviceId: 'phone-1' }, room)).json()).toEqual({ error: 'Room not found' });
      expect((await heartbeat({ deviceId: 'phone-1' }, room)).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/rooms/${room}/presence` })).statusCode).toBe(404);
      expect((await leave('phone-1', room)).statusCode).toBe(404);
    }
  });

  it('rejects invalid device and track ids', async () => {
    expect((await heartbeat({})).statusCode).toBe(400);
    expect((await heartbeat({ deviceId: '' })).statusCode).toBe(400);
    expect((await heartbeat({ deviceId: 'a/b' })).statusCode).toBe(400);
    expect((await heartbeat({ deviceId: 'x'.repeat(65) })).statusCode).toBe(400);
    expect((await heartbeat({ deviceId: 'phone-1', trackId: 'nope' })).statusCode).toBe(400);
  });

  it('tracks 100 concurrent devices in one room', async () => {
    await Promise.all(Array.from({ length: 100 }, (_, i) => heartbeat({ deviceId: `phone-${i}` })));
    expect(await present()).toHaveLength(100);
  });
});
