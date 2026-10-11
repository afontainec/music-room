import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { Db } from './db/client.js';
import { fileRoutes } from './routes/files.js';
import { helloRoutes } from './routes/hello.js';
import type { Storage } from './storage/storage.js';

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));

export interface AppDeps {
  db: Db;
  storage: Storage;
  maxUploadBytes: number;
}

// Routes that need the database are only registered when it is provided.
export async function buildApp(deps?: AppDeps) {
  const app = Fastify({ logger: true });

  await app.register(helloRoutes);
  if (deps) await app.register(fileRoutes, deps);

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
