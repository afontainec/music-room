import { Auth } from '../auth.js';

export const ADMIN = { username: 'staff', password: 'test-password' };

export const testAuth = (now?: () => number) =>
  new Auth({ ...ADMIN, secret: 'test-secret', ttlMs: 60 * 60 * 1000, now });

/** Headers for an admin request, signed by `auth`. */
export function adminHeaders(auth: Auth) {
  const session = auth.login(ADMIN.username, ADMIN.password)!;
  return { authorization: `Bearer ${session.token}` };
}
