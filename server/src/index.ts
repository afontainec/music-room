import { buildApp } from './app.js';
import { Auth } from './auth.js';
import { authOptions, maxUploadBytes, storageDir } from './config.js';
import { createDb } from './db/client.js';
import { LocalDiskStorage } from './storage/local.js';

// The database is optional so the app still boots (hello page only) without one.
const database = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : undefined;
const auth = new Auth(authOptions());
const app = await buildApp(
  database && {
    db: database.db,
    storage: new LocalDiskStorage(storageDir()),
    maxUploadBytes: maxUploadBytes(),
    auth,
  },
);
const port = Number(process.env.PORT ?? 3000);

if (database && !auth.enabled) app.log.warn('ADMIN_PASSWORD is not set: staff login is disabled');
if (database && auth.enabled && !process.env.AUTH_SECRET) {
  app.log.warn('AUTH_SECRET is not set: staff sessions end when the server restarts');
}

// Railway sends SIGTERM to the old deployment on every deploy. Exiting cleanly (code 0) lets
// in-flight requests finish and keeps the platform from reporting the stop as a crash.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    try {
      await app.close();
      await database?.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  });
}

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
