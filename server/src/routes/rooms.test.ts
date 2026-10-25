import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Db } from '../db/client.js';
import { migrateUp } from '../db/migrate.js';
import * as schema from '../db/schema.js';
import { ROOM_PALETTE } from '../palette.js';
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

  it("lists each room's track count, updated right after an upload or a removal", async () => {
    const counts = async () =>
      Object.fromEntries(
        (await app.inject({ method: 'GET', url: '/api/rooms', headers: admin }))
          .json()
          .map((r: { name: string; trackCount: number }) => [r.name, r.trackCount]),
      );
    const addUrl = async (roomId: string, url: string) =>
      (await app.inject({ method: 'POST', url: `/api/rooms/${roomId}/files/url`, headers: admin, payload: { url } })).json();
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
    await create('Empty');
    const one = (await create('One')).json();
    const many = (await create('Many')).json();
    await addUrl(one.id, 'https://example.com/one.mp3');
    for (const n of ['a', 'b', 'c']) await addUrl(many.id, `https://example.com/${n}.mp3`);
    expect(await counts()).toEqual({ Empty: 0, One: 1, Many: 3 });

    const uploaded = (await upload(one.id)).json();
    expect(await counts()).toEqual({ Empty: 0, One: 2, Many: 3 });
    await app.inject({ method: 'DELETE', url: `/api/files/${uploaded.id}`, headers: admin });
    expect(await counts()).toEqual({ Empty: 0, One: 1, Many: 3 });
  });

  it('lists all rooms to anonymous visitors with only their public fields', async () => {
    const forest = (await create('Forest')).json();
    const sea = (await create('Sea')).json();
    await app.inject({
      method: 'POST',
      url: `/api/rooms/${sea.id}/files/url`,
      headers: admin,
      payload: { url: 'https://example.com/waves.mp3' },
    });
    // A rejected token is ignored, not refused: the list needs none.
    for (const headers of [{}, { authorization: 'Bearer nope' }]) {
      const res = await app.inject({ method: 'GET', url: '/api/rooms', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([
        { id: forest.id, name: 'Forest', colour: forest.colour, trackCount: 0 },
        { id: sea.id, name: 'Sea', colour: sea.colour, trackCount: 1 },
      ]);
    }
  });

  it('keeps creating, renaming and deleting rooms for staff', async () => {
    const room = (await create('Forest')).json();
    for (const headers of [{}, { authorization: 'Bearer nope' }]) {
      expect((await create('Sea', headers)).statusCode).toBe(401);
      const rename = await app.inject({ method: 'PATCH', url: `/api/rooms/${room.id}`, headers, payload: { name: 'Sea' } });
      expect(rename.statusCode).toBe(401);
      expect((await app.inject({ method: 'DELETE', url: `/api/rooms/${room.id}`, headers })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'GET', url: '/api/rooms' })).json()).toMatchObject([{ name: 'Forest' }]);
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

  describe('colour', () => {
    const createIn = (name: string, colour: unknown) =>
      app.inject({ method: 'POST', url: '/api/rooms', headers: admin, payload: { name, colour } });
    const patch = (id: string, payload: object) =>
      app.inject({ method: 'PATCH', url: `/api/rooms/${id}`, headers: admin, payload });
    const get = async (id: string) => (await app.inject({ method: 'GET', url: `/api/rooms/${id}` })).json();
    // A room as created before colours: nothing stored.
    const legacyRoom = async (name: string, id: string) => {
      await db.insert(schema.rooms).values({ id, name });
      return id;
    };

    it('stores the colour given on create, case-insensitively', async () => {
      const res = await createIn('Forest', '#A99BE0');
      expect(res.statusCode).toBe(201);
      expect(res.json().colour).toBe('#a99be0');
      expect((await get(res.json().id)).colour).toBe('#a99be0');
    });

    it('assigns the first unused palette colour when none is given', async () => {
      expect((await create('A')).json().colour).toBe(ROOM_PALETTE[0]);
      await createIn('B', ROOM_PALETTE[2]);
      expect((await create('C')).json().colour).toBe(ROOM_PALETTE[1]);
      expect((await create('D')).json().colour).toBe(ROOM_PALETTE[3]);
    });

    it('assigns the least-used colour, earliest on a tie, once every colour is used', async () => {
      for (const [i, colour] of ROOM_PALETTE.entries()) await createIn(`Room ${i}`, colour);
      await createIn('Extra 1', ROOM_PALETTE[0]);
      await createIn('Extra 2', ROOM_PALETTE[1]);
      expect((await create('Next')).json().colour).toBe(ROOM_PALETTE[2]);
      expect((await create('After')).json().colour).toBe(ROOM_PALETTE[3]);
    });

    it('counts the derived colour of rooms without a stored one', async () => {
      await legacyRoom('Old', '00000000-0000-4000-8000-000000000000'); // derives palette[0]
      expect((await create('New')).json().colour).toBe(ROOM_PALETTE[1]);
    });

    it('rejects colours outside the palette on create', async () => {
      for (const colour of ['#000000', 'Moss', '', null, 3]) {
        const res = await createIn('Forest', colour);
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(/^Colour must be one of the room palette/);
      }
      expect((await app.inject({ method: 'GET', url: '/api/rooms', headers: admin })).json()).toEqual([]);
    });

    it('changes the colour on PATCH, alone or with the name', async () => {
      const room = (await create('Forest')).json();
      const res = await patch(room.id, { colour: ROOM_PALETTE[5] });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: 'Forest', colour: ROOM_PALETTE[5] });
      expect(await get(room.id)).toMatchObject({ name: 'Forest', colour: ROOM_PALETTE[5] });
      await patch(room.id, { name: 'Woods', colour: ROOM_PALETTE[6] });
      expect(await get(room.id)).toMatchObject({ name: 'Woods', colour: ROOM_PALETTE[6] });
      await patch(room.id, { name: 'Grove' });
      expect(await get(room.id)).toMatchObject({ name: 'Grove', colour: ROOM_PALETTE[6] });
    });

    it('rejects colours outside the palette on PATCH and keeps the room as it was', async () => {
      const room = (await createIn('Forest', ROOM_PALETTE[4])).json();
      for (const colour of ['#ffffff', 'red', null]) {
        expect((await patch(room.id, { colour })).statusCode).toBe(400);
        expect((await patch(room.id, { name: 'Woods', colour })).statusCode).toBe(400);
      }
      expect(await get(room.id)).toMatchObject({ name: 'Forest', colour: ROOM_PALETTE[4] });
    });

    it('returns each room colour from the list and the room', async () => {
      await createIn('A', ROOM_PALETTE[7]);
      const id = await legacyRoom('B', '00000000-0000-4000-8000-00000000000b');
      const list = (await app.inject({ method: 'GET', url: '/api/rooms', headers: admin })).json();
      expect(list.map((r: { colour: string }) => r.colour)).toEqual([ROOM_PALETTE[7], ROOM_PALETTE[0xb % 8]]);
      expect((await get(id)).colour).toBe(ROOM_PALETTE[0xb % 8]);
    });

    it('derives a stable colour from the id for a room without one, whatever other rooms do', async () => {
      const id = await legacyRoom('Old', '3f2c1a9e-1234-4abc-9def-0123deadbeef');
      const expected = ROOM_PALETTE[0xdeadbeef % 8];
      expect((await get(id)).colour).toBe(expected);
      const others = [];
      for (const name of ['A', 'B', 'C']) others.push((await create(name)).json().id);
      expect((await get(id)).colour).toBe(expected);
      for (const other of others) await app.inject({ method: 'DELETE', url: `/api/rooms/${other}`, headers: admin });
      expect((await get(id)).colour).toBe(expected);
      const [row] = await db.select().from(schema.rooms).where(eq(schema.rooms.id, id));
      expect(row.colour).toBeNull();
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
