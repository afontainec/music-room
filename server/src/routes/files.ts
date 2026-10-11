import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fastifyMultipart from '@fastify/multipart';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/client.js';
import { roomFiles, rooms } from '../db/schema.js';
import { ValidationError, validateMp3Upload, validateMp3Url } from '../files.js';
import type { Storage } from '../storage/storage.js';

export interface FileRoutesOptions {
  db: Db;
  storage: Storage;
  maxUploadBytes: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    start = Math.max(size - Number(m[2]), 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

export async function fileRoutes(app: FastifyInstance, opts: FileRoutesOptions) {
  const { db, storage, maxUploadBytes } = opts;

  await app.register(fastifyMultipart, { limits: { fileSize: maxUploadBytes, files: 1 } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.message });
    return reply.send(err);
  });

  async function roomExists(roomId: string): Promise<boolean> {
    if (!UUID.test(roomId)) return false;
    const [room] = await db.select({ id: rooms.id }).from(rooms).where(eq(rooms.id, roomId));
    return room !== undefined;
  }

  app.get<{ Params: { roomId: string } }>('/api/rooms/:roomId/files', async (req, reply) => {
    if (!(await roomExists(req.params.roomId))) return reply.code(404).send({ error: 'Room not found' });
    return db.select().from(roomFiles).where(eq(roomFiles.roomId, req.params.roomId));
  });

  // Multipart upload: one mp3 in the `file` field.
  app.post<{ Params: { roomId: string } }>('/api/rooms/:roomId/files', async (req, reply) => {
    if (!(await roomExists(req.params.roomId))) return reply.code(404).send({ error: 'Room not found' });
    const part = await req.file();
    if (!part) throw new ValidationError('Multipart field "file" is required');
    let data: Buffer;
    try {
      data = await part.toBuffer();
    } catch {
      throw new ValidationError(`File exceeds the ${maxUploadBytes} byte limit`);
    }
    const originalName = path.basename(part.filename);
    validateMp3Upload({ filename: originalName, mimeType: part.mimetype, data }, maxUploadBytes);

    const key = `${req.params.roomId}/${randomUUID()}.mp3`;
    await storage.put(key, data);
    try {
      const [row] = await db
        .insert(roomFiles)
        .values({
          roomId: req.params.roomId,
          source: 'upload',
          fileRef: key,
          originalName,
          mimeType: 'audio/mpeg',
          sizeBytes: data.length,
        })
        .returning();
      return reply.code(201).send(row);
    } catch (err) {
      await storage.delete(key);
      throw err;
    }
  });

  // Link an external mp3 by URL.
  app.post<{ Params: { roomId: string }; Body: { url?: unknown } }>(
    '/api/rooms/:roomId/files/url',
    async (req, reply) => {
      if (!(await roomExists(req.params.roomId))) return reply.code(404).send({ error: 'Room not found' });
      const url = validateMp3Url(req.body?.url);
      const [row] = await db
        .insert(roomFiles)
        .values({
          roomId: req.params.roomId,
          source: 'url',
          fileRef: url,
          originalName: path.basename(new URL(url).pathname),
        })
        .returning();
      return reply.code(201).send(row);
    },
  );

  // Playback: uploads are streamed with range support (seeking), external tracks are redirected.
  app.get<{ Params: { id: string } }>('/api/files/:id', async (req, reply) => {
    if (!UUID.test(req.params.id)) return reply.code(404).send({ error: 'File not found' });
    const [file] = await db.select().from(roomFiles).where(eq(roomFiles.id, req.params.id));
    if (!file) return reply.code(404).send({ error: 'File not found' });
    if (file.source === 'url') return reply.redirect(file.fileRef);

    const whole = await storage.open(file.fileRef);
    if (!whole) return reply.code(404).send({ error: 'File not found' });
    reply.header('Content-Type', 'audio/mpeg').header('Accept-Ranges', 'bytes');

    const header = req.headers.range;
    if (header) {
      const range = parseRange(header, whole.size);
      whole.stream.destroy();
      if (!range) return reply.code(416).header('Content-Range', `bytes */${whole.size}`).send();
      const part = await storage.open(file.fileRef, range);
      if (!part) return reply.code(404).send({ error: 'File not found' });
      return reply
        .code(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${whole.size}`)
        .header('Content-Length', range.end - range.start + 1)
        .send(part.stream);
    }
    return reply.header('Content-Length', whole.size).send(whole.stream);
  });
}
