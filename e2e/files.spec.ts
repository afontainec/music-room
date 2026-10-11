import { expect, test } from '@playwright/test';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://music_room:music_room@localhost:5432/music_room';

// There is no room API yet, so rooms are inserted directly.
async function createRoom(): Promise<string> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const name = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const res = await client.query('insert into rooms (name) values ($1) returning id', [name]);
    return res.rows[0].id;
  } finally {
    await client.end();
  }
}

const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(997, 7)]);

test('Mp3 files can be uploaded via multipart endpoint', async ({ request }) => {
  const roomId = await createRoom();
  const res = await request.post(`/api/rooms/${roomId}/files`, {
    multipart: { file: { name: 'song.mp3', mimeType: 'audio/mpeg', buffer: mp3 } },
  });
  expect(res.status()).toBe(201);
  expect(await res.json()).toMatchObject({ roomId, source: 'upload', originalName: 'song.mp3', sizeBytes: 1000 });
});

test('Mp3 files can be linked via URL', async ({ request }) => {
  const roomId = await createRoom();
  const res = await request.post(`/api/rooms/${roomId}/files/url`, {
    data: { url: 'https://example.com/one.mp3' },
  });
  expect(res.status()).toBe(201);
  expect(await res.json()).toMatchObject({ roomId, source: 'url', fileRef: 'https://example.com/one.mp3' });
});

test('File type is validated before persisting', async ({ request }) => {
  const roomId = await createRoom();
  const res = await request.post(`/api/rooms/${roomId}/files`, {
    multipart: { file: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') } },
  });
  expect(res.status()).toBe(400);
  const list = await request.get(`/api/rooms/${roomId}/files`);
  expect(await list.json()).toEqual([]);
});

test('File size is validated before persisting', async ({ request }) => {
  const roomId = await createRoom();
  const tooBig = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(21 * 1024 * 1024)]);
  const res = await request.post(`/api/rooms/${roomId}/files`, {
    multipart: { file: { name: 'big.mp3', mimeType: 'audio/mpeg', buffer: tooBig } },
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  const list = await request.get(`/api/rooms/${roomId}/files`);
  expect(await list.json()).toEqual([]);
});

test('File metadata is stored in room_files and the file is servable for playback', async ({ request }) => {
  const roomId = await createRoom();
  const up = await request.post(`/api/rooms/${roomId}/files`, {
    multipart: { file: { name: 'song.mp3', mimeType: 'audio/mpeg', buffer: mp3 } },
  });
  const file = await up.json();
  const list = await (await request.get(`/api/rooms/${roomId}/files`)).json();
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ id: file.id, originalName: 'song.mp3', fileRef: file.fileRef });

  const served = await request.get(`/api/files/${file.id}`);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('audio/mpeg');
  expect(Buffer.from(await served.body()).equals(mp3)).toBe(true);

  const ranged = await request.get(`/api/files/${file.id}`, { headers: { range: 'bytes=0-9' } });
  expect(ranged.status()).toBe(206);
});
