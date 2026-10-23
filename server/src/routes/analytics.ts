import { and, asc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Db } from '../db/client.js';
import { roomFiles, rooms, usageEvents } from '../db/schema.js';
import { roomColour } from '../palette.js';

export interface AnalyticsRoutesOptions {
  db: Db;
  /** Guards the report; recording events stays public, since visitors send them. */
  requireAdmin: preHandlerHookHandler;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same rule as the presence and layer routes: the tab's device id.
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A time needs an explicit offset, so the range never depends on the server's time zone.
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;

/**
 * A report bound: a UTC date (`2026-10-22`) or a date-time with an offset. `from` is inclusive and
 * `to` exclusive, except that a date-only `to` includes that whole UTC day. Undefined when absent,
 * null when invalid.
 */
export function parseBound(value: unknown, bound: 'from' | 'to'): Date | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') return null;
  if (DATE.test(value)) {
    const day = new Date(`${value}T00:00:00Z`);
    // Rejects days that do not exist, e.g. 2026-02-31, which Date would roll over.
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) return null;
    return bound === 'to' ? new Date(day.getTime() + DAY_MS) : day;
  }
  if (!DATE_TIME.test(value)) return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time;
}

const invalidBound = (bound: string) => ({
  error: `${bound} must be a date (YYYY-MM-DD, UTC) or a date-time with an offset (e.g. 2026-10-22T09:00:00Z)`,
});

// Visitors' pages record a visit when they enter a room and a play each time a layer starts
// playing. The database sets every timestamp, so clients cannot backdate events.
export async function analyticsRoutes(app: FastifyInstance, opts: AnalyticsRoutesOptions) {
  const { db, requireAdmin } = opts;

  const roomExists = async (id: string) => {
    if (!UUID.test(id)) return false;
    const [room] = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, id));
    return !!room;
  };
  const deviceIdError = { error: 'deviceId must be 1-64 letters, digits, "-" or "_"' };

  app.post<{ Params: { id: string }; Body: { deviceId?: unknown } }>(
    '/api/rooms/:id/visits',
    async (req, reply) => {
      const { deviceId } = req.body ?? {};
      if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) return reply.code(400).send(deviceIdError);
      if (!(await roomExists(req.params.id))) return reply.code(404).send({ error: 'Room not found' });
      await db.insert(usageEvents).values({ type: 'visit', roomId: req.params.id, deviceId });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string }; Body: { deviceId?: unknown; trackId?: unknown } }>(
    '/api/rooms/:id/plays',
    async (req, reply) => {
      const { deviceId, trackId } = req.body ?? {};
      if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) return reply.code(400).send(deviceIdError);
      if (typeof trackId !== 'string' || !UUID.test(trackId)) {
        return reply.code(400).send({ error: 'trackId must be a track id' });
      }
      if (!(await roomExists(req.params.id))) return reply.code(404).send({ error: 'Room not found' });
      const [track] = await db
        .select({ id: roomFiles.id })
        .from(roomFiles)
        .where(and(eq(roomFiles.id, trackId), eq(roomFiles.roomId, req.params.id)));
      if (!track) return reply.code(404).send({ error: 'Track not found in this room' });
      await db.insert(usageEvents).values({ type: 'play', roomId: req.params.id, trackId, deviceId });
      return reply.code(204).send();
    },
  );

  // Every room with its visits, distinct visiting devices and plays in [from, to). Rooms without
  // events in the range are listed with zeros. Deleted rooms take their events with them.
  app.get<{ Querystring: { from?: unknown; to?: unknown } }>(
    '/api/analytics/rooms',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const from = parseBound(req.query.from, 'from');
      if (from === null) return reply.code(400).send(invalidBound('from'));
      const to = parseBound(req.query.to, 'to');
      if (to === null) return reply.code(400).send(invalidBound('to'));
      if (from && to && from >= to) return reply.code(400).send({ error: 'from must be before to' });

      const inRange: SQL[] = [eq(usageEvents.roomId, rooms.id)];
      if (from) inRange.push(gte(usageEvents.occurredAt, from));
      if (to) inRange.push(lt(usageEvents.occurredAt, to));
      const counted = (type: 'visit' | 'play', expr: SQL) =>
        sql<number>`count(${expr}) filter (where ${usageEvents.type} = ${type})`.mapWith(Number);

      const rows = await db
        .select({
          id: rooms.id,
          name: rooms.name,
          colour: rooms.colour,
          visits: counted('visit', sql`${usageEvents.id}`),
          visitors: counted('visit', sql`distinct ${usageEvents.deviceId}`),
          plays: counted('play', sql`${usageEvents.id}`),
        })
        .from(rooms)
        .leftJoin(usageEvents, and(...inRange))
        .groupBy(rooms.id)
        .orderBy(asc(rooms.name));

      return {
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
        rooms: rows.map((room) => ({ ...room, colour: roomColour(room) })),
      };
    },
  );
}
