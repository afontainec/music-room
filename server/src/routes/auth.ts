import type { FastifyInstance } from 'fastify';
import { type Auth, bearerToken } from '../auth.js';

export interface AuthRoutesOptions {
  auth: Auth;
}

export async function authRoutes(app: FastifyInstance, opts: AuthRoutesOptions) {
  const { auth } = opts;

  app.post<{ Body: { username?: unknown; password?: unknown } }>('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return reply.code(400).send({ error: 'Username and password are required' });
    }
    if (!auth.enabled) return reply.code(503).send({ error: 'Staff login is not configured' });
    const session = auth.login(username, password);
    if (!session) return reply.code(401).send({ error: 'Invalid username or password' });
    return session;
  });

  // Lets the web app check a stored token before showing the staff area.
  app.get('/api/auth/session', { preHandler: auth.requireAdmin }, async (req) => {
    const result = auth.verify(bearerToken(req));
    return result.ok ? result.session : null;
  });
}
