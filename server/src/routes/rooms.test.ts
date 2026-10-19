import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { migrateUp } from '../db/migrate.js';
import * as schema from '../db/schema.js';
import { Presence } from '../presence.js';
import { LocalDiskStorage } from '../storage/local.js';
import { adminHeaders, testAuth } from '../test/admin.js';

const auth = testAuth();
const admin = adminHeaders(auth);

describe('room routes', () => {
  let app: FastifyInstance;
  let db: Db;
  let storage: LocalDiskStorage;
  let presence: Presence;

  beforeEach(async () => {
    db = drizzle(new PGlite(), { schema });
    await migrateUp(db);
    storage = new LocalDiskStorage(await mkdtemp(path.join(tmpdir(), 'music-room-')));
    presence = new Presence();
    app = await buildApp({ db, storage, maxUploadBytes: 1000, auth, presence });
  });

  const create = (name: unknown, headers = admin) =>
    app.inject({ method: 'POST', url: '/api/rooms', headers, payload: { name } });

  it('rejects creating a room without a valid staff session', async () => {
    const missing = await create('Chill', {});
    expect(missing.statusCode).toBe(401);
    expect(missing.headers['www-authenticate']).toBe('Bearer');
    expect(missing.json()).toEqual({ error: 'Authentication required' });
    expect((await create('Chill', { authorization: 'Bearer nope' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/rooms', headers: admin })).json()).toEqual([]);
  });

  it('creates a room', async () => {
    const res = await create('  Chill ');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Chill' });
  });

  it('rejects a duplicate name with a clear error', async () => {
    await create('Chill');
    const res = await create('Chill');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'A room named "Chill" already exists' });
  });

  it('rejects missing, blank and overlong names', async () => {
    expect((await create(undefined)).statusCode).toBe(400);
    expect((await create('   ')).statusCode).toBe(400);
    expect((await create(42)).statusCode).toBe(400);
    expect((await create('x'.repeat(101))).statusCode).toBe(400);
  });

  it('lists all rooms to staff', async () => {
    await create('B');
    await create('A');
    const res = await app.inject({ method: 'GET', url: '/api/rooms', headers: admin });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((r: { name: string }) => r.name)).toEqual(['A', 'B']);
  });

  it('answers an anonymous room list request with 401 and no room data', async () => {
    await create('Forest');
    for (const headers of [{}, { authorization: 'Bearer nope' }]) {
      const res = await app.inject({ method: 'GET', url: '/api/rooms', headers });
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.json()).toEqual({ error: 'Authentication required' });
    }
  });

  it('keeps a single room public', async () => {
    const room = (await create('Forest')).json();
    const res = await app.inject({ method: 'GET', url: `/api/rooms/${room.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: room.id, name: 'Forest', files: [] });
  });

  it('returns room details with its file list after assigning a url', async () => {
    const room = (await create('Chill')).json();
    await app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/files/url`,
      headers: admin,
      payload: { url: 'https://example.com/one.mp3' },
    });
    const res = await app.inject({ method: 'GET', url: `/api/rooms/${room.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: room.id, name: 'Chill' });
    expect(res.json().files).toHaveLength(1);
    expect(res.json().files[0]).toMatchObject({ source: 'url', fileRef: 'https://example.com/one.mp3' });
  });

  describe('next track', () => {
    const addUrl = async (roomId: string, url: string) =>
      (await app.inject({ method: 'POST', url: `/api/rooms/${roomId}/files/url`, headers: admin, payload: { url } })).json();
    const next = (roomId: string, after?: string) =>
      app.inject({ method: 'GET', url: `/api/rooms/${roomId}/next-track${after ? `?after=${after}` : ''}` });

    it('returns null for a room without tracks', async () => {
      const room = (await create('Empty')).json();
      expect((await next(room.id)).json()).toEqual({ track: null });
    });

    it("picks one of the room's tracks and never the one given as `after`", async () => {
      const room = (await create('Chill')).json();
      const one = await addUrl(room.id, 'https://example.com/one.mp3');
      const two = await addUrl(room.id, 'https://example.com/two.mp3');
      const res = await next(room.id);
      expect(res.statusCode).toBe(200);
      expect([one.id, two.id]).toContain(res.json().track.id);
      for (let i = 0; i < 10; i++) {
        expect((await next(room.id, one.id)).json().track.id).toBe(two.id);
        expect((await next(room.id, two.id)).json().track.id).toBe(one.id);
      }
    });

    it('repeats the only track of a one-track room', async () => {
      const room = (await create('Solo')).json();
      const only = await addUrl(room.id, 'https://example.com/one.mp3');
      expect((await next(room.id, only.id)).json().track.id).toBe(only.id);
    });

    it('returns 404 for unknown or malformed room ids', async () => {
      expect((await next('nope')).statusCode).toBe(404);
      expect((await next('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    });
  });

  describe('rename', () => {
    const rename = (id: string, name: unknown, headers = admin) =>
      app.inject({ method: 'PATCH', url: `/api/rooms/${id}`, headers, payload: { name } });

    it('renames a room, trimming the name', async () => {
      const room = (await create('Chill')).json();
      const res = await rename(room.id, '  Forest ');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: room.id, name: 'Forest' });
      expect((await app.inject({ method: 'GET', url: `/api/rooms/${room.id}` })).json().name).toBe('Forest');
    });

    it('rejects empty and overlong names', async () => {
      const room = (await create('Chill')).json();
      const blank = await rename(room.id, '   ');
      expect(blank.statusCode).toBe(400);
      expect(blank.json()).toEqual({ error: 'Room name is required' });
      expect((await rename(room.id, undefined)).statusCode).toBe(400);
      expect((await rename(room.id, 'x'.repeat(101))).statusCode).toBe(400);
    });

    it("rejects another room's name with a clear error, and keeps its own name", async () => {
      await create('Forest');
      const room = (await create('Chill')).json();
      const res = await rename(room.id, 'Forest');
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'A room named "Forest" already exists' });
      expect((await rename(room.id, 'Chill')).statusCode).toBe(200);
    });

    it('returns 404 for unknown or malformed ids', async () => {
      expect((await rename('nope', 'Forest')).statusCode).toBe(404);
      expect((await rename('00000000-0000-4000-8000-000000000000', 'Forest')).statusCode).toBe(404);
    });

    it('needs a staff session', async () => {
      const room = (await create('Chill')).json();
      expect((await rename(room.id, 'Forest', {})).statusCode).toBe(401);
    });
  });

  describe('delete', () => {
    const remove = (id: string, headers = admin) => app.inject({ method: 'DELETE', url: `/api/rooms/${id}`, headers });
    const upload = (roomId: string) =>
      app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/files`,
        headers: { ...admin, 'content-type': 'multipart/form-data; boundary=b' },
        payload: Buffer.concat([
          Buffer.from('--b\r\nContent-Disposition: form-data; name="file"; filename="birds.mp3"\r\n'),
          Buffer.from('Content-Type: audio/mpeg\r\n\r\n'),
          Buffer.concat([Buffer.from('ID3'), Buffer.alloc(97, 7)]),
          Buffer.from('\r\n--b--\r\n'),
        ]),
      });

    it('removes the room, its tracks, their uploaded mp3s and its presence', async () => {
      const room = (await create('Forest')).json();
      const other = (await create('Sea')).json();
      const file = (await upload(room.id)).json();
      const kept = (await upload(other.id)).json();
      await app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/files/url`,
        headers: admin,
        payload: { url: 'https://example.com/wind.mp3' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/presence/heartbeat`,
        payload: { deviceId: 'phone-1', trackId: file.id },
      });
      expect((await app.inject({ method: 'GET', url: `/api/files/${file.id}` })).statusCode).toBe(200);

      const res = await remove(room.id);
      expect(res.statusCode).toBe(204);
      expect((await app.inject({ method: 'GET', url: `/api/rooms/${room.id}` })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/files/${file.id}` })).statusCode).toBe(404);
      expect(await storage.open(file.fileRef)).toBeNull();
      expect(presence.present(room.id)).toEqual([]);
      expect(await db.select().from(schema.roomFiles)).toEqual([expect.objectContaining({ id: kept.id })]);
      expect(await storage.open(kept.fileRef)).not.toBeNull();
      expect((await app.inject({ method: 'GET', url: '/api/rooms', headers: admin })).json()).toEqual([
        expect.objectContaining({ name: 'Sea' }),
      ]);
    });

    it('still deletes the room when an mp3 cannot be deleted', async () => {
      const room = (await create('Forest')).json();
      await upload(room.id);
      storage.delete = async () => {
        throw new Error('disk on fire');
      };
      expect((await remove(room.id)).statusCode).toBe(204);
      expect((await app.inject({ method: 'GET', url: `/api/rooms/${room.id}` })).statusCode).toBe(404);
    });

    it('returns 404 for unknown or already deleted rooms', async () => {
      const room = (await create('Forest')).json();
      expect((await remove(room.id)).statusCode).toBe(204);
      expect((await remove(room.id)).statusCode).toBe(404);
      expect((await remove('nope')).statusCode).toBe(404);
      expect((await remove('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    });

    it('needs a staff session', async () => {
      const room = (await create('Forest')).json();
      expect((await remove(room.id, {})).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url: `/api/rooms/${room.id}` })).statusCode).toBe(200);
    });
  });

  it('returns 404 for unknown or malformed ids', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/rooms/nope' })).statusCode).toBe(404);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/api/rooms/${missing}` })).statusCode).toBe(404);
  });
});
