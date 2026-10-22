import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// The tables themselves are created by the migrations in ./migrations; keep the two in sync.

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique('rooms_name_unique'),
  // A colour from the room palette (server/src/palette.ts); null for rooms created before colours.
  colour: text('colour'),
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

// Room visits and track plays for analytics. Timestamps are set by the database, not the client.
export const usageEvents = pgTable(
  'usage_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type', { enum: ['visit', 'play'] }).notNull(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    // Set for plays; cleared when the track is removed, so its plays still count for the room.
    trackId: uuid('track_id').references(() => roomFiles.id, { onDelete: 'set null' }),
    // The tab's device id (one per tab session), so a report can count distinct visitors.
    deviceId: text('device_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('usage_events_room_id_occurred_at_idx').on(t.roomId, t.occurredAt),
    index('usage_events_track_id_idx').on(t.trackId),
    check('usage_events_type_check', sql`${t.type} in ('visit', 'play')`),
  ],
);

export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type RoomFile = typeof roomFiles.$inferSelect;
export type NewRoomFile = typeof roomFiles.$inferInsert;
