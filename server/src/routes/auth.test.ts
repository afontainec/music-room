import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { Auth } from '../auth.js';
import type { Db } from '../db/client.js';
import { migrateUp } from '../db/migrate.js';
import * as schema from '../db/schema.js';
import { LocalDiskStorage } from '../storage/local.js';
import { ADMIN, testAuth } from '../test/admin.js';

const HOUR = 60 * 60 * 1000;

describe('Auth', () => {
  it('issues a token for the right credentials and verifies it', () => {
    const auth = testAuth(() => 0);
    const session = auth.login(ADMIN.username, ADMIN.password)!;
    expect(session.expiresAt).toBe(new Date(HOUR).toISOString());
    expect(auth.verify(session.token)).toEqual({
      ok: true,
      session: { username: ADMIN.username, expiresAt: session.expiresAt },
    });
  });

  it('rejects a wrong username or password', () => {
    const auth = testAuth();
    expect(auth.login(ADMIN.username, 'wrong')).toBeNull();
    expect(auth.login('someone', ADMIN.password)).toBeNull();
    expect(auth.login('', '')).toBeNull();
  });

  it('expires tokens after the ttl', () => {
    let clock = 0;
    const auth = testAuth(() => clock);
    const { token } = auth.login(ADMIN.username, ADMIN.password)!;
    clock = HOUR - 1;
    expect(auth.verify(token).ok).toBe(true);
    clock = HOUR;
    expect(auth.verify(token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects tampered tokens and tokens signed with another secret', () => {
    const auth = testAuth();
    const { token } = auth.login(ADMIN.username, ADMIN.password)!;
    const [, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'staff', exp: Date.now() + 10 * HOUR })).toString('base64url');
    expect(auth.verify(`${forged}.${signature}`)).toEqual({ ok: false, reason: 'invalid' });
    expect(auth.verify(`${token}x`)).toEqual({ ok: false, reason: 'invalid' });
    expect(auth.verify('garbage')).toEqual({ ok: false, reason: 'invalid' });
    expect(auth.verify(undefined)).toEqual({ ok: false, reason: 'missing' });
    const other = new Auth({ ...ADMIN, secret: 'another-secret', ttlMs: HOUR });
    expect(other.verify(token)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('is disabled without a password', () => {
    const auth = new Auth({ username: 'staff', ttlMs: HOUR });
    expect(auth.enabled).toBe(false);
    expect(auth.login('staff', '')).toBeNull();
  });
});

describe('auth routes', () => {
  let app: FastifyInstance;
  let clock: number;

  async function build(auth: Auth) {
    const db: Db = drizzle(new PGlite(), { schema });
    await migrateUp(db);
    const dir = await mkdtemp(path.join(tmpdir(), 'music-room-'));
    return buildApp({ db, storage: new LocalDiskStorage(dir), maxUploadBytes: 1000, auth });
  }

  beforeEach(async () => {
    clock = 1_000_000;
    app = await build(testAuth(() => clock));
  });

  afterEach(() => app.close());

  const login = (payload: object) => app.inject({ method: 'POST', url: '/api/auth/login', payload });
  const createRoom = (token?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: { name: 'Forest' },
    });

  it('logs in with the staff credentials', async () => {
    const res = await login(ADMIN);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ token: expect.any(String), expiresAt: new Date(clock + HOUR).toISOString() });
    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { authorization: `Bearer ${res.json().token}` },
    });
    expect(session.json()).toEqual({ username: ADMIN.username, expiresAt: res.json().expiresAt });
  });

  it('rejects wrong and missing credentials', async () => {
    const wrong = await login({ ...ADMIN, password: 'nope' });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'Invalid username or password' });
    expect((await login({ username: ADMIN.username })).statusCode).toBe(400);
    expect((await login({ username: 1, password: 2 })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/auth/session' })).statusCode).toBe(401);
  });

  it('admin endpoints accept a token until it expires', async () => {
    const { token } = (await login(ADMIN)).json();
    expect((await createRoom()).statusCode).toBe(401);
    expect((await createRoom(token)).statusCode).toBe(201);
    clock += HOUR;
    const expired = await createRoom(token);
    expect(expired.statusCode).toBe(401);
    expect(expired.json()).toEqual({ error: 'Session expired, log in again' });
  });

  it('answers 503 and keeps admin endpoints closed when no password is configured', async () => {
    await app.close();
    app = await build(new Auth({ username: 'staff', ttlMs: HOUR }));
    expect((await login({ username: 'staff', password: 'anything' })).statusCode).toBe(503);
    expect((await createRoom('anything')).statusCode).toBe(401);
  });

  it('keeps visitor endpoints and the room list public', async () => {
    const { token } = (await login(ADMIN)).json();
    const room = (await createRoom(token)).json();
    expect((await app.inject({ method: 'GET', url: `/api/rooms/${room.id}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/rooms' })).statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/rooms', headers: { authorization: `Bearer ${token}` } });
    expect(list.statusCode).toBe(200);
  });
});
