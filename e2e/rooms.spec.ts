import { expect, test } from '@playwright/test';
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

test('GET /rooms lists all rooms', async ({ request }) => {
  const name = unique();
  await request.post('/api/rooms', { headers: await adminHeaders(request), data: { name } });
  const res = await request.get('/api/rooms');
  expect(res.status()).toBe(200);
  expect((await res.json()).map((r: { name: string }) => r.name)).toContain(name);
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

test('Duplicate room name returns clear error', async ({ request }) => {
  const headers = await adminHeaders(request);
  const name = unique();
  await request.post('/api/rooms', { headers, data: { name } });
  const res = await request.post('/api/rooms', { headers, data: { name } });
  expect(res.status()).toBe(409);
  expect(await res.json()).toEqual({ error: `A room named "${name}" already exists` });
});
