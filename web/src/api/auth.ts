export interface Session {
  username: string;
  expiresAt: string;
}

// The staff token lives in localStorage so a login survives reloads and new tabs until it expires.
const TOKEN_KEY = 'music-room.staffToken';

// Fired in this tab when the token is stored or cleared; other tabs get the browser's `storage` event.
const TOKEN_CHANGE_EVENT = 'music-room:staff-token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event(TOKEN_CHANGE_EVENT));
}

/** Calls `listener` whenever the staff token is stored or cleared, in this tab or another. */
export function onTokenChange(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOKEN_KEY || e.key === null) listener();
  };
  window.addEventListener(TOKEN_CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(TOKEN_CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Headers for admin API calls. */
export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export class LoginError extends Error {}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !body.token) throw new LoginError(body.error ?? 'Could not log in. Please try again.');
  localStorage.setItem(TOKEN_KEY, body.token);
  window.dispatchEvent(new Event(TOKEN_CHANGE_EVENT));
}

/** The current staff session, or null when there is no valid (unexpired) token. */
export async function getSession(): Promise<Session | null> {
  if (!getToken()) return null;
  const res = await fetch('/api/auth/session', { headers: authHeaders() });
  if (res.status === 401) {
    clearToken();
    return null;
  }
  if (!res.ok) throw new Error(`GET /api/auth/session failed with ${res.status}`);
  return res.json() as Promise<Session>;
}
