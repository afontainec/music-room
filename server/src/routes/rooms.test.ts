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
import { LocalDiskStorage } from '../storage/local.js';

describe('room routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const db: Db = drizzle(new PGlite(), { schema });
    await migrateUp(db);
    const dir = await mkdtemp(path.join(tmpdir(), 'music-room-'));
    app = await buildApp({ db, storage: new LocalDiskStorage(dir), maxUploadBytes: 1000 });
  });

  const create = (name: unknown) => app.inject({ method: 'POST', url: '/api/rooms', payload: { name } });

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

  it('lists all rooms', async () => {
    await create('B');
    await create('A');
    const res = await app.inject({ method: 'GET', url: '/api/rooms' });
    expect(res.json().map((r: { name: string }) => r.name)).toEqual(['A', 'B']);
  });

  it('returns room details with its file list after assigning a url', async () => {
    const room = (await create('Chill')).json();
    await app.inject({
      method: 'POST',
      url: `/api/rooms/${room.id}/files/url`,
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
      (await app.inject({ method: 'POST', url: `/api/rooms/${roomId}/files/url`, payload: { url } })).json();
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

  it('returns 404 for unknown or malformed ids', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/rooms/nope' })).statusCode).toBe(404);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await app.inject({ method: 'GET', url: `/api/rooms/${missing}` })).statusCode).toBe(404);
  });
});
