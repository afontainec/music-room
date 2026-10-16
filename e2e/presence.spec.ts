import { expect, test, type APIRequestContext } from '@playwright/test';

// Presence has no UI yet (layer assignment will consume it), so these drive the API directly.
const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function createRoom(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/rooms', { data: { name: unique() } });
  expect(res.status()).toBe(201);
  return (await res.json()).id;
}

const deviceIds = async (request: APIRequestContext, roomId: string) => {
  const res = await request.get(`/api/rooms/${roomId}/presence`);
  expect(res.status()).toBe(200);
  return ((await res.json()).devices as { deviceId: string }[]).map((d) => d.deviceId).sort();
};

const heartbeat = (request: APIRequestContext, roomId: string, deviceId: string) =>
  request.post(`/api/rooms/${roomId}/presence/heartbeat`, { data: { deviceId } });

test("A heartbeat call registers/refreshes a device's presence in a room", async ({ request }) => {
  const roomId = await createRoom(request);
  const first = await heartbeat(request, roomId, 'phone-1');
  expect(first.status()).toBe(200);
  const { lastSeen } = await first.json();
  expect(await deviceIds(request, roomId)).toEqual(['phone-1']);

  await new Promise((r) => setTimeout(r, 50));
  const second = await heartbeat(request, roomId, 'phone-1');
  expect((await second.json()).lastSeen).toBeGreaterThan(lastSeen);
  expect(await deviceIds(request, roomId)).toEqual(['phone-1']);
});

test('A device that stops sending heartbeats is dropped within 30 seconds', async ({ request }) => {
  test.setTimeout(60_000);
  const roomId = await createRoom(request);
  await heartbeat(request, roomId, 'silent');
  await heartbeat(request, roomId, 'alive');
  expect(await deviceIds(request, roomId)).toEqual(['alive', 'silent']);

  // Keep one device alive while the other goes quiet; the quiet one is gone by the 30 s mark.
  const start = Date.now();
  await expect
    .poll(
      async () => {
        await heartbeat(request, roomId, 'alive');
        return deviceIds(request, roomId);
      },
      { timeout: 32_000, intervals: [2_000] },
    )
    .toEqual(['alive']);
  expect(Date.now() - start).toBeLessThanOrEqual(31_000);
});

test('An explicit leave call removes the device immediately', async ({ request }) => {
  const roomId = await createRoom(request);
  await heartbeat(request, roomId, 'phone-1');
  const res = await request.delete(`/api/rooms/${roomId}/presence/phone-1`);
  expect(res.status()).toBe(204);
  expect(await deviceIds(request, roomId)).toEqual([]);
});

test('Unknown room ids return a clear not-found response', async ({ request }) => {
  const missing = '00000000-0000-0000-0000-000000000000';
  const res = await heartbeat(request, missing, 'phone-1');
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ error: 'Room not found' });
  expect((await request.get(`/api/rooms/${missing}/presence`)).status()).toBe(404);
  expect((await request.delete(`/api/rooms/${missing}/presence/phone-1`)).status()).toBe(404);
});

test('Presence state scales to 100 concurrent devices in one room', async ({ request }) => {
  const roomId = await createRoom(request);
  const ids = Array.from({ length: 100 }, (_, i) => `phone-${String(i).padStart(3, '0')}`);
  const beats = await Promise.all(ids.map((id) => heartbeat(request, roomId, id)));
  expect(beats.every((r) => r.status() === 200)).toBe(true);
  expect(await deviceIds(request, roomId)).toEqual(ids);

  const leaves = await Promise.all(ids.map((id) => request.delete(`/api/rooms/${roomId}/presence/${id}`)));
  expect(leaves.every((r) => r.status() === 204)).toBe(true);
  expect(await deviceIds(request, roomId)).toEqual([]);
});
