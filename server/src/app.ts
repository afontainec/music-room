import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Db } from './db/client.js';
import { fileRoutes } from './routes/files.js';
import { helloRoutes } from './routes/hello.js';
import { Presence } from './presence.js';
import { presenceRoutes } from './routes/presence.js';
import { roomRoutes } from './routes/rooms.js';
import type { Storage } from './storage/storage.js';

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));

export interface AppDeps {
  db: Db;
  storage: Storage;
  maxUploadBytes: number;
  /** Injectable for tests (fake clock); defaults to a store with the 30 s TTL. */
  presence?: Presence;
}

// Routes that need the database are only registered when it is provided.
export async function buildApp(deps?: AppDeps) {
  const app = Fastify({ logger: true });

  await app.register(helloRoutes);
  if (deps) {
    await app.register(roomRoutes, { db: deps.db });
    await app.register(fileRoutes, deps);
    const presence = deps.presence ?? new Presence();
    presence.start();
    app.addHook('onClose', async () => presence.stop());
    await app.register(presenceRoutes, { db: deps.db, presence });
  }

  // Single Railway service: serve the built SPA from the same Node process.
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
