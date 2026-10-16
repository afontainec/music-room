import { mkdtemp, rm } from 'node:fs/promises';
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
import { rooms } from '../db/schema.js';
import { trackName, validateMp3Upload, validateMp3Url } from '../files.js';
import { LocalDiskStorage } from '../storage/local.js';

const MAX = 1000;
const mp3 = (size = 100) => Buffer.concat([Buffer.from('ID3'), Buffer.alloc(size - 3, 1)]);

function multipart(filename: string, type: string, data: Buffer) {
  const boundary = 'x-boundary';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head), data, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('validation', () => {
  const ok = { filename: 'a.mp3', mimeType: 'audio/mpeg', data: mp3() };
  it('accepts an mp3', () => expect(() => validateMp3Upload(ok, MAX)).not.toThrow());
  it('accepts a bare frame sync', () =>
    expect(() => validateMp3Upload({ ...ok, data: Buffer.from([0xff, 0xfb, 0x90]) }, MAX)).not.toThrow());
  it('rejects a wrong extension', () => expect(() => validateMp3Upload({ ...ok, filename: 'a.wav' }, MAX)).toThrow());
  it('rejects a wrong mime type', () =>
    expect(() => validateMp3Upload({ ...ok, mimeType: 'text/plain' }, MAX)).toThrow());
  it('rejects non-mp3 content', () =>
    expect(() => validateMp3Upload({ ...ok, data: Buffer.from('hello world') }, MAX)).toThrow());
  it('rejects oversized files', () => expect(() => validateMp3Upload({ ...ok, data: mp3(MAX + 1) }, MAX)).toThrow());
  it('rejects empty files', () => expect(() => validateMp3Upload({ ...ok, data: Buffer.alloc(0) }, MAX)).toThrow());
  it('validates urls', () => {
    expect(validateMp3Url('https://example.com/a/b.MP3')).toBe('https://example.com/a/b.MP3');
    expect(() => validateMp3Url('ftp://example.com/a.mp3')).toThrow();
    expect(() => validateMp3Url('https://example.com/a.wav')).toThrow();
    expect(() => validateMp3Url('nope')).toThrow();
    expect(() => validateMp3Url(undefined)).toThrow();
  });
});

describe('trackName', () => {
  it('strips the extension from the original file name', () => {
    expect(trackName({ originalName: 'Forest Birds.mp3', fileRef: 'r/x.mp3' })).toBe('Forest Birds');
    expect(trackName({ originalName: 'wind.v2.MP3', fileRef: 'r/x.mp3' })).toBe('wind.v2');
  });
  it('falls back to the file reference', () =>
    expect(trackName({ originalName: null, fileRef: 'https://example.com/a/stream.mp3' })).toBe('stream'));
});

describe('file routes', () => {
  let client: PGlite;
  let app: FastifyInstance;
  let dir: string;
  let roomId: string;

  beforeEach(async () => {
    client = new PGlite();
    const db: Db = drizzle(client, { schema });
    await migrateUp(db);
    const [room] = await db.insert(rooms).values({ name: 'Chill' }).returning({ id: rooms.id });
    roomId = room!.id;
    dir = await mkdtemp(path.join(tmpdir(), 'music-room-'));
    app = await buildApp({ db, storage: new LocalDiskStorage(dir), maxUploadBytes: MAX });
  });

  afterEach(async () => {
    await app.close();
    await client.close();
    await rm(dir, { recursive: true, force: true });
  });

  const upload = (filename: string, type: string, data: Buffer, room = roomId) =>
    app.inject({ method: 'POST', url: `/api/rooms/${room}/files`, ...multipart(filename, type, data) });

  it('persists an upload, links it to the room and serves it', async () => {
    const data = mp3(200);
    const res = await upload('song.mp3', 'audio/mpeg', data);
    expect(res.statusCode).toBe(201);
    const file = res.json();
    expect(file).toMatchObject({ roomId, source: 'upload', originalName: 'song.mp3', sizeBytes: 200 });

    const list = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}/files` });
    expect(list.json()).toHaveLength(1);

    const served = await app.inject({ method: 'GET', url: `/api/files/${file.id}` });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('audio/mpeg');
    expect(served.rawPayload.equals(data)).toBe(true);
  });

  it('serves byte ranges', async () => {
    const data = mp3(200);
    const file = (await upload('song.mp3', 'audio/mpeg', data)).json();
    const res = await app.inject({ method: 'GET', url: `/api/files/${file.id}`, headers: { range: 'bytes=10-19' } });
    expect(res.statusCode).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 10-19/200');
    expect(res.rawPayload.equals(data.subarray(10, 20))).toBe(true);
    const bad = await app.inject({ method: 'GET', url: `/api/files/${file.id}`, headers: { range: 'bytes=500-' } });
    expect(bad.statusCode).toBe(416);
  });

  it('rejects non-mp3 and oversized uploads without persisting', async () => {
    expect((await upload('a.txt', 'text/plain', Buffer.from('hello'))).statusCode).toBe(400);
    expect((await upload('a.mp3', 'audio/mpeg', Buffer.from('not an mp3'))).statusCode).toBe(400);
    expect((await upload('a.mp3', 'audio/mpeg', mp3(MAX + 1))).statusCode).toBeGreaterThanOrEqual(400);
    const list = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}/files` });
    expect(list.json()).toEqual([]);
  });

  it('links an external url and redirects to it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/files/url`,
      payload: { url: 'https://example.com/tracks/one.mp3' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ source: 'url', fileRef: 'https://example.com/tracks/one.mp3' });
    const served = await app.inject({ method: 'GET', url: `/api/files/${res.json().id}` });
    expect(served.statusCode).toBe(302);
    expect(served.headers.location).toBe('https://example.com/tracks/one.mp3');
  });

  it('rejects invalid urls', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/rooms/${roomId}/files/url`, payload: { url: 'x' } });
    expect(res.statusCode).toBe(400);
  });

  it('404s for unknown rooms and files', async () => {
    expect((await upload('a.mp3', 'audio/mpeg', mp3(), crypto.randomUUID())).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/files/nope' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/files/${crypto.randomUUID()}` })).statusCode).toBe(404);
  });

  it('lists every track of the room with id, name and playable url', async () => {
    const song = (await upload('Forest Birds.mp3', 'audio/mpeg', mp3())).json();
    const link = (
      await app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/files/url`,
        payload: { url: 'https://example.com/a/wind.mp3' },
      })
    ).json();
    const list = (await app.inject({ method: 'GET', url: `/api/rooms/${roomId}/files` })).json();
    expect(list).toHaveLength(2);
    expect(list).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: song.id, name: 'Forest Birds', url: `/api/files/${song.id}` }),
        expect.objectContaining({ id: link.id, name: 'wind', url: `/api/files/${link.id}` }),
      ]),
    );
    const served = await app.inject({ method: 'GET', url: list.find((t: { id: string }) => t.id === song.id).url });
    expect(served.statusCode).toBe(200);
  });

  it('returns an empty list for a room without tracks and 404 for an unknown room', async () => {
    const empty = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}/files` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/rooms/${crypto.randomUUID()}/files` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/rooms/nope/files' })).statusCode).toBe(404);
  });

  it('never includes tracks of other rooms', async () => {
    const other = (await app.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'Other' } })).json();
    const mine = (await upload('mine.mp3', 'audio/mpeg', mp3())).json();
    await upload('theirs.mp3', 'audio/mpeg', mp3(), other.id);
    const list = (await app.inject({ method: 'GET', url: `/api/rooms/${roomId}/files` })).json();
    expect(list.map((t: { id: string }) => t.id)).toEqual([mine.id]);
  });
});
