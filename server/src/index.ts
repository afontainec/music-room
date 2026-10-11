import { buildApp } from './app.js';
import { maxUploadBytes, storageDir } from './config.js';
import { createDb } from './db/client.js';
import { LocalDiskStorage } from './storage/local.js';

// The database is optional so the app still boots (hello page only) without one.
const database = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : undefined;
const app = await buildApp(
  database && {
    db: database.db,
    storage: new LocalDiskStorage(storageDir()),
    maxUploadBytes: maxUploadBytes(),
  },
);
const port = Number(process.env.PORT ?? 3000);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
