import { expect, test, type Page } from '@playwright/test';
import { adminHeaders, signToken, STAFF } from './admin';

const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(997, 7)]);
const TOKEN_KEY = 'music-room.staffToken';

async function logIn(page: Page, username: string, password: string) {
  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Staff login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

test('Staff can log in with the shared account and reach the staff area', async ({ page }) => {
  await logIn(page, STAFF.username, STAFF.password);
  await expect(page).toHaveURL('/admin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Staff area');
  await expect(page.getByText(`Signed in as ${STAFF.username}.`)).toBeVisible();
  // The session survives a reload.
  await page.reload();
  await expect(page.getByText(`Signed in as ${STAFF.username}.`)).toBeVisible();
});

test('Login fails with wrong credentials and shows a clear error', async ({ page, request }) => {
  await logIn(page, STAFF.username, 'wrong-password');
  await expect(page.getByRole('alert')).toHaveText('Invalid username or password');
  await expect(page).toHaveURL('/admin/login');
  expect(await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY)).toBeNull();

  const res = await request.post('/api/auth/login', { data: { username: 'someone', password: STAFF.password } });
  expect(res.status()).toBe(401);
});

test('The staff area requires a login, and logging out ends the session', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL('/admin/login');

  await logIn(page, STAFF.username, STAFF.password);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Staff area');
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/admin/login');
  await page.goto('/admin');
  await expect(page).toHaveURL('/admin/login');
});

test('Admin endpoints reject unauthenticated requests', async ({ request }) => {
  const name = unique();
  const create = await request.post('/api/rooms', { data: { name } });
  expect(create.status()).toBe(401);
  expect(await create.json()).toEqual({ error: 'Authentication required' });
  const forged = await request.post('/api/rooms', { headers: { authorization: 'Bearer forged.token' }, data: { name } });
  expect(forged.status()).toBe(401);
  const headers = await adminHeaders(request);
  expect((await (await request.get('/api/rooms', { headers })).json()).map((r: { name: string }) => r.name)).not.toContain(
    name,
  );

  const room = await (await request.post('/api/rooms', { headers, data: { name } })).json();
  const upload = await request.post(`/api/rooms/${room.id}/files`, {
    multipart: { file: { name: 'song.mp3', mimeType: 'audio/mpeg', buffer: mp3 } },
  });
  expect(upload.status()).toBe(401);
  const link = await request.post(`/api/rooms/${room.id}/files/url`, { data: { url: 'https://example.com/one.mp3' } });
  expect(link.status()).toBe(401);
  // Visitor routes stay public.
  expect((await request.get(`/api/rooms/${room.id}/files`)).status()).toBe(200);
  expect(await (await request.get(`/api/rooms/${room.id}/files`)).json()).toEqual([]);
});

test('An expired session is rejected and sends staff back to the login page', async ({ page, request }) => {
  const expired = signToken({ sub: STAFF.username, exp: Date.now() - 1000 });
  const res = await request.post('/api/rooms', {
    headers: { authorization: `Bearer ${expired}` },
    data: { name: unique() },
  });
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: 'Session expired, log in again' });

  // A still-valid token from the same key is accepted, so the rejection above is the expiry.
  const valid = signToken({ sub: STAFF.username, exp: Date.now() + 60_000 });
  const ok = await request.post('/api/rooms', { headers: { authorization: `Bearer ${valid}` }, data: { name: unique() } });
  expect(ok.status()).toBe(201);

  await page.addInitScript(([key, token]) => localStorage.setItem(key, token), [TOKEN_KEY, expired] as const);
  await page.goto('/admin');
  await expect(page).toHaveURL('/admin/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Staff login');
});
