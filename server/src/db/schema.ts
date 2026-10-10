import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// The tables themselves are created by the migrations in ./migrations; keep the two in sync.

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique('rooms_name_unique'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const roomFiles = pgTable(
  'room_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    // Tracks have two sources: a file uploaded to our storage, or an external URL.
    source: text('source', { enum: ['upload', 'url'] }).notNull(),
    // Storage key for uploads, the URL itself for external tracks.
    fileRef: text('file_ref').notNull(),
    originalName: text('original_name'),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    // Not filled in yet; here so duration and ordering don't need a migration later.
    durationSeconds: real('duration_seconds'),
    position: integer('position'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('room_files_room_id_idx').on(t.roomId),
    check('room_files_source_check', sql`${t.source} in ('upload', 'url')`),
  ],
);

export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type RoomFile = typeof roomFiles.$inferSelect;
export type NewRoomFile = typeof roomFiles.$inferInsert;
