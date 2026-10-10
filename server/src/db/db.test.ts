import { PGlite } from '@electric-sql/pglite';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './client.js';
import { migrateDown, migrateUp } from './migrate.js';
import { migrations } from './migrations/index.js';
import * as schema from './schema.js';
import { roomFiles, rooms } from './schema.js';

// In-memory Postgres, so these run without a database service.
let client: PGlite;
let db: Db;

beforeEach(() => {
  client = new PGlite();
  db = drizzle(client, { schema });
});

afterEach(async () => {
  await client.close();
});

async function tableNames(): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
  );
  return result.rows.map((r) => r.table_name);
}

// The driver wraps Postgres errors; the SQLSTATE code is on the cause.
async function sqlState(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    let e = err as { code?: string; cause?: unknown } | undefined;
    while (e && e.code === undefined) e = e.cause as typeof e;
    return e?.code;
  }
  return undefined;
}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const CHECK_VIOLATION = '23514';

describe('migrations run up/down cleanly', () => {
  it('up creates rooms and room_files', async () => {
    expect(await migrateUp(db)).toEqual(migrations.map((m) => m.name));
    expect(await tableNames()).toEqual(['room_files', 'rooms', 'schema_migrations']);
  });

  it('up is a no-op when everything is applied', async () => {
    await migrateUp(db);
    expect(await migrateUp(db)).toEqual([]);
  });

  it('down removes everything up created', async () => {
    await migrateUp(db);
    const rolledBack = await migrateDown(db, migrations.length);
    expect(rolledBack).toEqual(migrations.map((m) => m.name).reverse());
    expect(await tableNames()).toEqual(['schema_migrations']);
  });

  it('up works again after down', async () => {
    await migrateUp(db);
    await migrateDown(db, migrations.length);
    expect(await migrateUp(db)).toEqual(migrations.map((m) => m.name));
    expect(await tableNames()).toEqual(['room_files', 'rooms', 'schema_migrations']);
  });

  it('a failing migration leaves nothing behind', async () => {
    const broken = { name: '9999_broken', up: ['create table half_done (id int)', 'not sql'], down: [] };
    await expect(migrateUp(db, [broken])).rejects.toThrow();
    expect(await tableNames()).toEqual(['schema_migrations']);
    expect(await migrateUp(db, [])).toEqual([]);
  });
});

describe('rooms', () => {
  beforeEach(async () => {
    await migrateUp(db);
  });

  it('has an id, a name and timestamps', async () => {
    const [room] = await db.insert(rooms).values({ name: 'Lobby' }).returning();
    expect(room.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(room.name).toBe('Lobby');
    expect(room.createdAt).toBeInstanceOf(Date);
    expect(room.updatedAt).toBeInstanceOf(Date);
  });

  it('unique constraint is enforced on room name', async () => {
    await db.insert(rooms).values({ name: 'Lobby' });
    expect(await sqlState(db.insert(rooms).values({ name: 'Lobby' }))).toBe(UNIQUE_VIOLATION);
    expect(await db.select().from(rooms)).toHaveLength(1);
  });

  it('requires a name', async () => {
    await expect(db.execute(sql`insert into rooms default values`)).rejects.toThrow();
  });
});

describe('room_files', () => {
  let roomId: string;

  beforeEach(async () => {
    await migrateUp(db);
    [{ id: roomId }] = await db.insert(rooms).values({ name: 'Lobby' }).returning();
  });

  it('belongs to a room and round-trips every column', async () => {
    const [file] = await db
      .insert(roomFiles)
      .values({
        roomId,
        source: 'upload',
        fileRef: 'rooms/lobby/track.mp3',
        originalName: 'track.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: 5_000_000,
        durationSeconds: 182.5,
        position: 1,
      })
      .returning();
    expect(file).toMatchObject({
      roomId,
      source: 'upload',
      fileRef: 'rooms/lobby/track.mp3',
      originalName: 'track.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 5_000_000,
      durationSeconds: 182.5,
      position: 1,
    });
    expect(file.createdAt).toBeInstanceOf(Date);
  });

  it('rejects a file whose room does not exist', async () => {
    const insert = db.insert(roomFiles).values({
      roomId: '00000000-0000-0000-0000-000000000000',
      source: 'url',
      fileRef: 'https://example.com/a.mp3',
    });
    expect(await sqlState(insert)).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('rejects an unknown source', async () => {
    const insert = db.execute(
      sql`insert into room_files (room_id, source, file_ref) values (${roomId}, 'ftp', 'x')`,
    );
    expect(await sqlState(insert)).toBe(CHECK_VIOLATION);
  });

  it('is deleted with its room', async () => {
    await db.insert(roomFiles).values({ roomId, source: 'url', fileRef: 'https://example.com/a.mp3' });
    await db.delete(rooms).where(eq(rooms.id, roomId));
    expect(await db.select().from(roomFiles)).toHaveLength(0);
  });
});
