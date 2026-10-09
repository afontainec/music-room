import type { FastifyInstance } from 'fastify';

export const HELLO_MESSAGE = 'Hello world from Music World';

export async function helloRoutes(app: FastifyInstance) {
  app.get('/api/hello', async () => ({ message: HELLO_MESSAGE }));
}
