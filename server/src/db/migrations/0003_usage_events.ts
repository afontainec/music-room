import type { Migration } from './index.js';

// Room visits and track plays for the owner's analytics, one row per event. Deleting a room
// deletes its events; removing a track keeps its plays (counted for the room) with no track id.
export const migration: Migration = {
  name: '0003_usage_events',
  up: [
    `create table usage_events (
      id uuid primary key default gen_random_uuid(),
      type text not null,
      room_id uuid not null references rooms (id) on delete cascade,
      track_id uuid references room_files (id) on delete set null,
      device_id text not null,
      occurred_at timestamptz not null default now(),
      constraint usage_events_type_check check (type in ('visit', 'play'))
    )`,
    `create index usage_events_room_id_occurred_at_idx on usage_events (room_id, occurred_at)`,
    `create index usage_events_track_id_idx on usage_events (track_id)`,
  ],
  down: [`drop table usage_events`],
};
