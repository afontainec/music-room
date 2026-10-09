import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { helloRoutes } from './hello.js';

describe('GET /api/hello', () => {
  it('returns the greeting', async () => {
    const app = Fastify();
    await app.register(helloRoutes);
    const res = await app.inject({ method: 'GET', url: '/api/hello' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message: 'Hello world from Music World' });
  });
});
