import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Db } from '../db/client.js';
import { rooms } from '../db/schema.js';
import type { Presence } from '../presence.js';

export interface PresenceRoutesOptions {
  db: Db;
  presence: Presence;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Devices pick their own id (e.g. crypto.randomUUID()); keep it short and URL-safe.
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

// Each listening device sends a heartbeat every few seconds; it stops counting as present
// 30 seconds after its last one, or right away when it leaves.
export async function presenceRoutes(app: FastifyInstance, opts: PresenceRoutesOptions) {
  const { db, presence } = opts;

  const roomExists = async (id: string) => {
    if (!UUID.test(id)) return false;
    const [room] = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, id));
    return !!room;
  };
  const roomNotFound = (reply: FastifyReply) => reply.code(404).send({ error: 'Room not found' });

  app.post<{ Params: { id: string }; Body: { deviceId?: unknown; trackId?: unknown } }>(
    '/api/rooms/:id/presence/heartbeat',
    async (req, reply) => {
      const { deviceId, trackId = null } = req.body ?? {};
      if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) {
        return reply.code(400).send({ error: 'deviceId must be 1-64 letters, digits, "-" or "_"' });
      }
      if (trackId !== null && (typeof trackId !== 'string' || !UUID.test(trackId))) {
        return reply.code(400).send({ error: 'trackId must be a track id or null' });
      }
      if (!(await roomExists(req.params.id))) return roomNotFound(reply);
      return presence.heartbeat(req.params.id, deviceId, trackId);
    },
  );

  app.get<{ Params: { id: string } }>('/api/rooms/:id/presence', async (req, reply) => {
    if (!(await roomExists(req.params.id))) return roomNotFound(reply);
    return { devices: presence.present(req.params.id) };
  });

  app.delete<{ Params: { id: string; deviceId: string } }>(
    '/api/rooms/:id/presence/:deviceId',
    async (req, reply) => {
      if (!(await roomExists(req.params.id))) return roomNotFound(reply);
      if (!presence.leave(req.params.id, req.params.deviceId)) {
        return reply.code(404).send({ error: 'Device not present in this room' });
      }
      return reply.code(204).send();
    },
  );
}
