import { createHmac } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';

/** The staff account and token key playwright.config.ts gives the test server. */
export const STAFF = { username: 'staff', password: 'e2e-staff-password' };
const AUTH_SECRET = 'e2e-auth-secret';

/** A token signed like the server's (server/src/auth.ts), for claims a real login cannot produce. */
export function signToken(claims: { sub: string; exp: number }) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url')}`;
}

const sessions = new WeakMap<APIRequestContext, Promise<Record<string, string>>>();

async function logIn(request: APIRequestContext) {
  const res = await request.post('/api/auth/login', { data: STAFF });
  expect(res.status()).toBe(200);
  return { authorization: `Bearer ${(await res.json()).token}` };
}

/** Headers for admin API calls (creating rooms, adding tracks); logs in once per request context. */
export function adminHeaders(request: APIRequestContext) {
  let headers = sessions.get(request);
  if (!headers) {
    headers = logIn(request);
    sessions.set(request, headers);
  }
  return headers;
}
