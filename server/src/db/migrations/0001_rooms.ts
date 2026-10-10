import type { Migration } from './index.js';

export const migration: Migration = {
  name: '0001_rooms',
  up: [
    `create table rooms (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint rooms_name_unique unique (name)
    )`,
    `create table room_files (
      id uuid primary key default gen_random_uuid(),
      room_id uuid not null references rooms (id) on delete cascade,
      source text not null,
      file_ref text not null,
      original_name text,
      mime_type text,
      size_bytes integer,
      duration_seconds real,
      position integer,
      created_at timestamptz not null default now(),
      constraint room_files_source_check check (source in ('upload', 'url'))
    )`,
    `create index room_files_room_id_idx on room_files (room_id)`,
  ],
  down: [`drop table room_files`, `drop table rooms`],
};
