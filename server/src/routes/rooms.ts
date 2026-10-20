import { asc, count, eq, getTableColumns, sql } from 'drizzle-orm';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Db } from '../db/client.js';
import { type Room, roomFiles, rooms } from '../db/schema.js';
import { defaultColour, invalidColour, parseColour, roomColour } from '../palette.js';
import { pickNextTrack } from '../playback.js';
import type { Presence } from '../presence.js';
import type { Storage } from '../storage/storage.js';

export interface RoomRoutesOptions {
  db: Db;
  /** Deleting a room deletes its uploaded mp3s. */
  storage: Storage;
  /** Deleting a room forgets the devices listening in it. */
  presence: Presence;
  /** Guards the admin routes and the room list (staff only); a single room's routes stay public. */
  requireAdmin: preHandlerHookHandler;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 100;

/** The trimmed name, or the 400 error. */
function parseName(value: unknown): { name: string } | { error: string } {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) return { error: 'Room name is required' };
  if (name.length > MAX_NAME_LENGTH) return { error: `Room name must be at most ${MAX_NAME_LENGTH} characters` };
  return { name };
}

/** The room as the API returns it: `colour` is always a palette colour, derived from the id when none is stored. */
const withColour = <R extends Room>(room: R) => ({ ...room, colour: roomColour(room) });

const duplicateName = (name: string) => ({ error: `A room named "${name}" already exists` });

// Postgres unique_violation; drizzle wraps driver errors, so look at the cause too.
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

// Files are assigned to a room through the file routes: POST /api/rooms/:roomId/files (upload)
// and POST /api/rooms/:roomId/files/url (external URL).
export async function roomRoutes(app: FastifyInstance, opts: RoomRoutesOptions) {
  const { db, storage, presence, requireAdmin } = opts;

  // Without a colour the room gets the default for the colours existing rooms show. Two rooms
  // created at once may get the same one; colours need not be unique, so that is acceptable.
  app.post<{ Body: { name?: unknown; colour?: unknown } }>(
    '/api/rooms',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const parsed = parseName(req.body?.name);
      if ('error' in parsed) return reply.code(400).send(parsed);
      const { name } = parsed;
      let colour: string | undefined;
      const requested = req.body?.colour;
      if (requested === undefined) {
        const existing = await db.select({ id: rooms.id, colour: rooms.colour }).from(rooms);
        colour = defaultColour(existing.map(roomColour));
      } else {
        colour = parseColour(requested);
        if (!colour) return reply.code(400).send(invalidColour);
      }
      const [room] = await db.insert(rooms).values({ name, colour }).onConflictDoNothing().returning();
      if (!room) return reply.code(409).send(duplicateName(name));
      return reply.code(201).send(withColour(room));
    },
  );

  // Rename and/or recolour. The unique constraint, not a prior lookup, decides duplicates, so two
  // renames cannot race.
  app.patch<{ Params: { id: string }; Body: { name?: unknown; colour?: unknown } }>(
    '/api/rooms/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Room not found' });
      const body = req.body ?? {};
      const changes: { name?: string; colour?: string } = {};
      // The name is required unless the request only changes the colour.
      if (body.name !== undefined || body.colour === undefined) {
        const parsed = parseName(body.name);
        if ('error' in parsed) return reply.code(400).send(parsed);
        changes.name = parsed.name;
      }
      if (body.colour !== undefined) {
        changes.colour = parseColour(body.colour);
        if (!changes.colour) return reply.code(400).send(invalidColour);
      }
      try {
        const [room] = await db
          .update(rooms)
          .set({ ...changes, updatedAt: sql`now()` })
          .where(eq(rooms.id, req.params.id))
          .returning();
        if (!room) return reply.code(404).send({ error: 'Room not found' });
        return withColour(room);
      } catch (err) {
        if (isUniqueViolation(err)) return reply.code(409).send(duplicateName(changes.name ?? ''));
        throw err;
      }
    },
  );

  // Removes the room and its tracks in one transaction, then the uploaded mp3s and the room's
  // presence. Blobs go after the commit, so a failed transaction leaves every track playable;
  // a blob that fails to delete is logged as an orphan, since the room is gone either way.
  app.delete<{ Params: { id: string } }>('/api/rooms/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const roomId = req.params.id;
    if (!UUID.test(roomId)) return reply.code(404).send({ error: 'Room not found' });
    const files = await db.transaction(async (tx) => {
      // Locking the room blocks concurrent track inserts (their foreign key check), so every
      // track is in the list below and none is removed by the cascade without its blob.
      const [room] = await tx.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId)).for('update');
      if (!room) return null;
      const deleted = await tx.delete(roomFiles).where(eq(roomFiles.roomId, roomId)).returning();
      await tx.delete(rooms).where(eq(rooms.id, roomId));
      return deleted;
    });
    if (!files) return reply.code(404).send({ error: 'Room not found' });

    presence.clearRoom(roomId);
    const keys = files.filter((f) => f.source === 'upload').map((f) => f.fileRef);
    const results = await Promise.allSettled(keys.map((key) => storage.delete(key)));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        req.log.error({ err: result.reason, roomId, key: keys[i] }, 'Could not delete an mp3 of a deleted room');
      }
    });
    return reply.code(204).send();
  });

  // The full list is for staff; visitors open a room by its id (a link they were given).
  // `trackCount` is counted on every request, so it follows uploads and removals at once.
  app.get('/api/rooms', { preHandler: requireAdmin }, async () =>
    (
      await db
        .select({ ...getTableColumns(rooms), trackCount: count(roomFiles.id) })
        .from(rooms)
        .leftJoin(roomFiles, eq(roomFiles.roomId, rooms.id))
        .groupBy(rooms.id)
        .orderBy(asc(rooms.name))
    ).map(withColour),
  );

  app.get<{ Params: { id: string } }>('/api/rooms/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'Room not found' });
    const [room] = await db.select().from(rooms).where(eq(rooms.id, req.params.id));
    if (!room) return reply.code(404).send({ error: 'Room not found' });
    const files = await db
      .select()
      .from(roomFiles)
      .where(eq(roomFiles.roomId, room.id))
      .orderBy(asc(roomFiles.createdAt));
    return { ...withColour(room), files };
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
