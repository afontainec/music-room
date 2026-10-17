import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface AuthOptions {
  /** The single shared staff account. */
  username: string;
  /** Unset disables login: every admin route then answers 401. */
  password?: string;
  /** HMAC key for session tokens. A random one (the default) invalidates sessions on restart. */
  secret?: string;
  ttlMs: number;
  /** Injectable for tests. */
  now?: () => number;
}

export interface Session {
  username: string;
  expiresAt: string;
}

export type Verification = { ok: true; session: Session } | { ok: false; reason: 'missing' | 'invalid' | 'expired' };

const digest = (value: string) => createHash('sha256').update(value).digest();
// Hashing first makes both sides the same length, so the comparison takes the same time either way.
const equal = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/**
 * Stateless sessions for the shared staff account: a token is `<payload>.<signature>`, the payload
 * being base64url JSON `{ sub, exp }` and the signature its HMAC-SHA256. Tokens cannot be revoked
 * before they expire (logging out forgets the token on the client); there is no refresh, staff log
 * in again once a token expires.
 */
export class Auth {
  readonly enabled: boolean;
  private readonly secret: string;
  private readonly now: () => number;

  constructor(private readonly opts: AuthOptions) {
    this.enabled = Boolean(opts.password);
    this.secret = opts.secret || randomBytes(32).toString('hex');
    this.now = opts.now ?? Date.now;
  }

  /** A token for the right credentials, null otherwise. */
  login(username: string, password: string): { token: string; expiresAt: string } | null {
    if (!this.opts.password) return null;
    // Both checks always run, so timing does not reveal which one failed.
    const userOk = equal(username, this.opts.username);
    const passwordOk = equal(password, this.opts.password);
    if (!userOk || !passwordOk) return null;
    const exp = this.now() + this.opts.ttlMs;
    const payload = Buffer.from(JSON.stringify({ sub: username, exp })).toString('base64url');
    return { token: `${payload}.${this.sign(payload)}`, expiresAt: new Date(exp).toISOString() };
  }

  verify(token: string | undefined): Verification {
    if (!token) return { ok: false, reason: 'missing' };
    if (!this.enabled) return { ok: false, reason: 'invalid' };
    const [payload, signature, ...rest] = token.split('.');
    if (!payload || !signature || rest.length > 0) return { ok: false, reason: 'invalid' };
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: 'invalid' };
    let claims: { sub?: unknown; exp?: unknown };
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'invalid' };
    }
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return { ok: false, reason: 'invalid' };
    if (claims.exp <= this.now()) return { ok: false, reason: 'expired' };
    return { ok: true, session: { username: claims.sub, expiresAt: new Date(claims.exp).toISOString() } };
  }

  /** Fastify preHandler for admin routes: 401 unless the request carries a valid bearer token. */
  readonly requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const result = this.verify(bearerToken(req));
    if (result.ok) return;
    const error = result.reason === 'expired' ? 'Session expired, log in again' : 'Authentication required';
    return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error });
  };

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}

export function bearerToken(req: FastifyRequest): string | undefined {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  return m?.[1];
}
