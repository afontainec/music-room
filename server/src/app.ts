import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { helloRoutes } from './routes/hello.js';

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(helloRoutes);

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
