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

// Directory for uploaded mp3s: the Railway volume mount in production.
export function storageDir(): string {
  return process.env.STORAGE_DIR ?? './data/uploads';
}
