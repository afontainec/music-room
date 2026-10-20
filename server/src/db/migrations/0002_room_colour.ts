import type { Migration } from './index.js';

// Nullable: rooms created before colours show one derived from their id (server/src/palette.ts).
// Validated against the palette by the API, not the database, so the palette can change freely.
export const migration: Migration = {
  name: '0002_room_colour',
  up: [`alter table rooms add column colour text`],
  down: [`alter table rooms drop column colour`],
};
