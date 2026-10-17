import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { roomFiles, rooms } from '../db/schema.js';
import { trackName } from '../files.js';
import { pickLeastUsedTrack } from '../playback.js';
import type { Presence } from '../presence.js';

export interface LayerRoutesOptions {
  db: Db;
  presence: Presence;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Same rule as the presence routes: the device's id becomes its presence entry.
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

// A device calls this when it joins a room and again whenever its track ends. The server picks
// the least-used track among the other present devices and records it as the device's track,
// which also counts as a heartbeat.
export async function layerRoutes(app: FastifyInstance, opts: LayerRoutesOptions) {
  const { db, presence } = opts;

  app.post<{ Params: { id: string }; Body: { deviceId?: unknown; previousTrackId?: unknown } }>(
    '/api/rooms/:id/layer',
    async (req, reply) => {
      const { deviceId, previousTrackId = null } = req.body ?? {};
      if (typeof deviceId !== 'string' || !DEVICE_ID.test(deviceId)) {
        return reply.code(400).send({ error: 'deviceId must be 1-64 letters, digits, "-" or "_"' });
      }
      if (previousTrackId !== null && (typeof previousTrackId !== 'string' || !UUID.test(previousTrackId))) {
        return reply.code(400).send({ error: 'previousTrackId must be a track id or null' });
      }
      const roomId = req.params.id;
      if (!UUID.test(roomId)) return reply.code(404).send({ error: 'Room not found' });
      const [room] = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId));
      if (!room) return reply.code(404).send({ error: 'Room not found' });
      const files = await db.select().from(roomFiles).where(eq(roomFiles.roomId, roomId));

      // Everything from here to the heartbeat is synchronous, so concurrent requests cannot
      // interleave and both read the same counts (single process, see presence.ts).
      const counts = new Map<string, number>();
      let ownTrackId: string | null = null;
      for (const device of presence.present(roomId)) {
        if (device.deviceId === deviceId) {
          ownTrackId = device.trackId;
        } else if (device.trackId) {
          counts.set(device.trackId, (counts.get(device.trackId) ?? 0) + 1);
        }
      }
      // Without an explicit previous track, the one the server last gave this device is it.
      const track = pickLeastUsedTrack(files, counts, (previousTrackId as string | null) ?? ownTrackId);
      presence.heartbeat(roomId, deviceId, track?.id ?? null);

      if (!track) return { track: null, reason: 'no-tracks', message: 'This room has no tracks yet' };
      return { track: { id: track.id, name: trackName(track), url: `/api/files/${track.id}` } };
    },
  );
}
