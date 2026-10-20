import { expect, test } from '@playwright/test';
import pg from 'pg';
import { adminHeaders } from './admin';

const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(997, 7)]);

test('POST endpoint creates a room with unique name', async ({ request }) => {
  const name = unique();
  const res = await request.post('/api/rooms', { headers: await adminHeaders(request), data: { name } });
  expect(res.status()).toBe(201);
  expect(await res.json()).toMatchObject({ name });
});

test('Endpoint(s) assign uploaded/linked mp3 files to a room', async ({ request }) => {
  const headers = await adminHeaders(request);
  const room = await (await request.post('/api/rooms', { headers, data: { name: unique() } })).json();
  const upload = await request.post(`/api/rooms/${room.id}/files`, {
    headers,
    multipart: { file: { name: 'song.mp3', mimeType: 'audio/mpeg', buffer: mp3 } },
  });
  expect(upload.status()).toBe(201);
  const link = await request.post(`/api/rooms/${room.id}/files/url`, {
    headers,
    data: { url: 'https://example.com/one.mp3' },
  });
  expect(link.status()).toBe(201);
});

test('Authenticated staff request returns the full room list as today', async ({ request }) => {
  const headers = await adminHeaders(request);
  const name = unique();
  await request.post('/api/rooms', { headers, data: { name } });
  const res = await request.get('/api/rooms', { headers });
  expect(res.status()).toBe(200);
  expect((await res.json()).map((r: { name: string }) => r.name)).toContain(name);
});

test('Anonymous request to the room-list endpoint returns 401/403 with no room data', async ({ request }) => {
  const name = unique();
  await request.post('/api/rooms', { headers: await adminHeaders(request), data: { name } });
  for (const headers of [{}, { authorization: 'Bearer forged.token' }]) {
    const res = await request.get('/api/rooms', { headers });
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: 'Authentication required' });
  }
});

test('GET of a single room by id remains public and unaffected', async ({ request }) => {
  const name = unique();
  const room = await (await request.post('/api/rooms', { headers: await adminHeaders(request), data: { name } })).json();
  const res = await request.get(`/api/rooms/${room.id}`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ id: room.id, name, files: [] });
});

test('GET /rooms/:id returns room details and its file list', async ({ request }) => {
  const headers = await adminHeaders(request);
  const name = unique();
  const room = await (await request.post('/api/rooms', { headers, data: { name } })).json();
  await request.post(`/api/rooms/${room.id}/files/url`, { headers, data: { url: 'https://example.com/one.mp3' } });
  const res = await request.get(`/api/rooms/${room.id}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ id: room.id, name });
  expect(body.files).toHaveLength(1);
  expect(body.files[0]).toMatchObject({ source: 'url', fileRef: 'https://example.com/one.mp3' });
});

test('PATCH /api/rooms/:id rejects empty or duplicate names with a clear error and otherwise updates the name', async ({
  request,
}) => {
  const headers = await adminHeaders(request);
  const taken = unique();
  await request.post('/api/rooms', { headers, data: { name: taken } });
  const room = await (await request.post('/api/rooms', { headers, data: { name: unique() } })).json();

  const empty = await request.patch(`/api/rooms/${room.id}`, { headers, data: { name: '  ' } });
  expect(empty.status()).toBe(400);
  expect(await empty.json()).toEqual({ error: 'Room name is required' });

  const duplicate = await request.patch(`/api/rooms/${room.id}`, { headers, data: { name: taken } });
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toEqual({ error: `A room named "${taken}" already exists` });

  const name = unique();
  const renamed = await request.patch(`/api/rooms/${room.id}`, { headers, data: { name: ` ${name} ` } });
  expect(renamed.status()).toBe(200);
  expect(await renamed.json()).toMatchObject({ id: room.id, name });
  expect(await (await request.get(`/api/rooms/${room.id}`)).json()).toMatchObject({ name });
});

test('DELETE /api/rooms/:id removes the room, its files, their stored mp3s and its playback state', async ({
  request,
}) => {
  const headers = await adminHeaders(request);
  const room = await (await request.post('/api/rooms', { headers, data: { name: unique() } })).json();
  const upload = await (
    await request.post(`/api/rooms/${room.id}/files`, {
      headers,
      multipart: { file: { name: 'birds.mp3', mimeType: 'audio/mpeg', buffer: mp3 } },
    })
  ).json();
  const link = await (
    await request.post(`/api/rooms/${room.id}/files/url`, { headers, data: { url: 'https://example.com/wind.mp3' } })
  ).json();
  await request.post(`/api/rooms/${room.id}/presence/heartbeat`, { data: { deviceId: unique(), trackId: upload.id } });
  expect((await request.get(`/api/files/${upload.id}`)).status()).toBe(200);

  const res = await request.delete(`/api/rooms/${room.id}`, { headers });
  expect(res.status()).toBe(204);
  expect((await request.get(`/api/rooms/${room.id}`)).status()).toBe(404);
  expect((await (await request.get('/api/rooms', { headers })).json()).map((r: { id: string }) => r.id)).not.toContain(
    room.id,
  );
  expect((await request.get(`/api/files/${upload.id}`)).status()).toBe(404);
  expect((await request.get(`/api/files/${link.id}`, { maxRedirects: 0 })).status()).toBe(404);
  expect((await request.get(`/api/rooms/${room.id}/presence`)).status()).toBe(404);
});

test('Deleting or renaming a non-existent room returns 404', async ({ request }) => {
  const headers = await adminHeaders(request);
  const missing = '00000000-0000-4000-8000-000000000000';
  const rename = await request.patch(`/api/rooms/${missing}`, { headers, data: { name: unique() } });
  expect(rename.status()).toBe(404);
  expect(await rename.json()).toEqual({ error: 'Room not found' });
  expect((await request.delete(`/api/rooms/${missing}`, { headers })).status()).toBe(404);

  const room = await (await request.post('/api/rooms', { headers, data: { name: unique() } })).json();
  expect((await request.delete(`/api/rooms/${room.id}`, { headers })).status()).toBe(204);
  expect((await request.delete(`/api/rooms/${room.id}`, { headers })).status()).toBe(404);
  expect((await request.patch(`/api/rooms/${room.id}`, { headers, data: { name: unique() } })).status()).toBe(404);
});

test('Duplicate room name returns clear error', async ({ request }) => {
  const headers = await adminHeaders(request);
  const name = unique();
  await request.post('/api/rooms', { headers, data: { name } });
  const res = await request.post('/api/rooms', { headers, data: { name } });
  expect(res.status()).toBe(409);
  expect(await res.json()).toEqual({ error: `A room named "${name}" already exists` });
});

const palette = ['#7fbf95', '#7fa8e0', '#a99be0', '#e0ae7f', '#e08a84', '#6cc4c0', '#d9c46a', '#d98fb8'];
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://music_room:music_room@localhost:5432/music_room';

/** The default from the issue, for the colours rooms show. */
function expectedDefault(colours: string[]): string {
  const count = (c: string) => colours.filter((x) => x === c).length;
  return palette.reduce((best, c) => (count(c) < count(best) ? c : best));
}

test('POST /api/rooms accepts an optional colour; if omitted the server assigns the first unused palette colour, or the least-used (earliest on a tie) once all are used', async ({
  request,
}) => {
  const headers = await adminHeaders(request);
  const chosen = await request.post('/api/rooms', { headers, data: { name: unique(), colour: '#D98FB8' } });
  expect(chosen.status()).toBe(201);
  expect((await chosen.json()).colour).toBe('#d98fb8');

  // Other test files create rooms in parallel, so retry until none lands between the read and the create.
  await expect(async () => {
    const before = (await (await request.get('/api/rooms', { headers })).json()).map((r: { colour: string }) => r.colour);
    const room = await (await request.post('/api/rooms', { headers, data: { name: unique() } })).json();
    expect(room.colour).toBe(expectedDefault(before));
  }).toPass();
});

test('Colours outside the palette are rejected with 400 on create and on PATCH /api/rooms/:id', async ({ request }) => {
  const headers = await adminHeaders(request);
  const name = unique();
  for (const colour of ['#000000', 'Moss', null]) {
    const res = await request.post('/api/rooms', { headers, data: { name, colour } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/^Colour must be one of the room palette/);
  }
  const room = await (await request.post('/api/rooms', { headers, data: { name, colour: palette[2] } })).json();
  const bad = await request.patch(`/api/rooms/${room.id}`, { headers, data: { colour: '#123456' } });
  expect(bad.status()).toBe(400);
  expect((await (await request.get(`/api/rooms/${room.id}`)).json()).colour).toBe(palette[2]);

  const good = await request.patch(`/api/rooms/${room.id}`, { headers, data: { colour: palette[5] } });
  expect(good.status()).toBe(200);
  expect(await good.json()).toMatchObject({ name, colour: palette[5] });
});

test("GET /api/rooms and GET /api/rooms/:id return each room's colour", async ({ request }) => {
  const headers = await adminHeaders(request);
  const room = await (await request.post('/api/rooms', { headers, data: { name: unique(), colour: palette[3] } })).json();
  const list = await (await request.get('/api/rooms', { headers })).json();
  expect(list.find((r: { id: string }) => r.id === room.id).colour).toBe(palette[3]);
  for (const r of list) expect(palette).toContain(r.colour);
  expect((await (await request.get(`/api/rooms/${room.id}`)).json()).colour).toBe(palette[3]);
});

test('A room without a stored colour returns a palette colour derived from its id (stable across other rooms being added/removed)', async ({
  request,
}) => {
  const headers = await adminHeaders(request);
  // Rooms created before colours have none stored; only the database can make one now.
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let id: string;
  try {
    id = (await client.query('insert into rooms (name) values ($1) returning id', [unique()])).rows[0].id;
  } finally {
    await client.end();
  }
  const expected = palette[Number.parseInt(id.replace(/-/g, '').slice(-8), 16) % palette.length];
  const colour = async () => (await (await request.get(`/api/rooms/${id}`)).json()).colour;
  expect(await colour()).toBe(expected);

  const other = await (await request.post('/api/rooms', { headers, data: { name: unique() } })).json();
  expect(await colour()).toBe(expected);
  await request.delete(`/api/rooms/${other.id}`, { headers });
  expect(await colour()).toBe(expected);
  const listed = (await (await request.get('/api/rooms', { headers })).json()).find((r: { id: string }) => r.id === id);
  expect(listed.colour).toBe(expected);
});
