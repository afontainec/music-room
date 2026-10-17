import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Db } from '../db/client.js';
import { roomFiles, rooms } from '../db/schema.js';
import { pickNextTrack } from '../playback.js';

export interface RoomRoutesOptions {
  db: Db;
  /** Guards the admin routes (staff only); the read routes stay public. */
  requireAdmin: preHandlerHookHandler;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 100;

// Files are assigned to a room through the file routes: POST /api/rooms/:roomId/files (upload)
// and POST /api/rooms/:roomId/files/url (external URL).
export async function roomRoutes(app: FastifyInstance, opts: RoomRoutesOptions) {
  const { db, requireAdmin } = opts;

  app.post<{ Body: { name?: unknown } }>('/api/rooms', { preHandler: requireAdmin }, async (req, reply) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) return reply.code(400).send({ error: 'Room name is required' });
    if (name.length > MAX_NAME_LENGTH) {
      return reply.code(400).send({ error: `Room name must be at most ${MAX_NAME_LENGTH} characters` });
    }
    const [room] = await db.insert(rooms).values({ name }).onConflictDoNothing().returning();
    if (!room) return reply.code(409).send({ error: `A room named "${name}" already exists` });
    return reply.code(201).send(room);
  });

  app.get('/api/rooms', async () => db.select().from(rooms).orderBy(asc(rooms.name)));

  app.get<{ Params: { id: string } }>('/api/rooms/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Room not found' });
    const [room] = await db.select().from(rooms).where(eq(rooms.id, req.params.id));
    if (!room) return reply.code(404).send({ error: 'Room not found' });
    const files = await db
      .select()
      .from(roomFiles)
      .where(eq(roomFiles.roomId, room.id))
      .orderBy(asc(roomFiles.createdAt));
    return { ...room, files };
  });

  // Random pick on the server, so it can become the room's shared playback state once listeners sync.
  // `after` is the track that just played; it is skipped unless it is the room's only track.
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/api/rooms/:id/next-track',
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Room not found' });
      const [room] = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, req.params.id));
      if (!room) return reply.code(404).send({ error: 'Room not found' });
      const files = await db.select().from(roomFiles).where(eq(roomFiles.roomId, room.id));
      return { track: pickNextTrack(files, req.query.after) ?? null };
    },
  );
}
