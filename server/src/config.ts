import type { AuthOptions } from './auth.js';

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env or export it.');
  }
  return url;
}

// The maximum mp3 size is not decided yet, hence configurable. Defaults to 20 MB.
export function maxUploadBytes(): number {
  const raw = process.env.MAX_UPLOAD_BYTES;
  if (!raw) return 20 * 1024 * 1024;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error('MAX_UPLOAD_BYTES must be a positive integer');
  return n;
}

// The single shared staff account. Without ADMIN_PASSWORD staff login is off and every admin
// route answers 401. Without AUTH_SECRET a random key is used, so sessions end on restart.
export function authOptions(): AuthOptions {
  const raw = process.env.AUTH_TOKEN_TTL_SECONDS;
  const ttlSeconds = raw ? Number(raw) : 12 * 60 * 60;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('AUTH_TOKEN_TTL_SECONDS must be a positive integer');
  }
  return {
    username: process.env.ADMIN_USERNAME || 'staff',
    password: process.env.ADMIN_PASSWORD || undefined,
    secret: process.env.AUTH_SECRET || undefined,
    ttlMs: ttlSeconds * 1000,
  };
}

// Directory for uploaded mp3s: the Railway volume mount in production.
export function storageDir(): string {
  return process.env.STORAGE_DIR ?? './data/uploads';
}
