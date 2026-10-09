# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Walking skeleton only: `GET /api/hello` on the server and a page that renders its response. No rooms, database or auth yet. The Product, Stack and Design sections below come from the product brief and stack decisions made with the user; correct them when something is built differently.

## Commands

Node 22 (`.nvmrc`). Run from the repo root:

- `npm ci` — install all workspaces
- `npm run dev:server` / `npm run dev:web` — Fastify on port 3000, Vite dev server proxying `/api` to it
- `npm run build` — build `web/` then `server/`
- `npm start` — run the built server, which also serves `web/dist` (one service in production)
- `npm test` — Vitest (server); a single file: `npm test -w server -- src/routes/hello.test.ts`
- `npm run test:e2e` — Playwright; builds and boots the server on port 3100 itself (first time: `npx playwright install chromium`)

CI (`.github/workflows/ci.yml`) runs build, Vitest and Playwright on every push and PR. Railway reads `railway.json`.

## Product

Music Rooms is a web app with named "rooms", each holding its own list of mp3 files. A visitor picks a room and hears continuous, ambient random playback of that room's tracks. Listeners in the same room should hear the same track at roughly the same position.

Three audiences:

- **Visitors** (desktop and mobile browsers, no login): choose a room, listen, control their own volume and mute.
- **Staff/admins** (logged in): create, rename and delete rooms; upload, list and remove mp3s per room. Changes must show up immediately in the public app.
- **Owner**: basic analytics — room visits and track plays per room, filterable by date range.

## Stack

Confirmed:

- **Backend**: Node.js with Fastify and TypeScript
- **Frontend**: React + TypeScript single-page app built with Vite; the public player and the admin dashboard are routes in the same app
- **Database**: Postgres, accessed through Drizzle ORM (schema and migrations in TypeScript)
- **Repo layout**: npm workspaces with `server/` and `web/` packages
- **Tests**: Vitest
- **Sync transport**: WebSockets — a default, to revisit once expected listeners per room and acceptable drift are known
- **Hosting**: Railway — one long-running Node service, managed Postgres, and a persistent volume for mp3s
- **Mp3 storage**: local disk (the Railway volume) for the MVP, to be swapped for S3-compatible object storage later

Hosting consequences to design around:

- A volume attaches to a single instance, so the app runs as one replica until mp3s move to object storage. Don't rely on horizontal scaling or zero-downtime deploys before then.
- Railway's Hobby plan caps a volume at 5 GB (about 1,000 tracks at 5 MB each, across all rooms).
- Audio streaming is billed as network egress, so serving mp3s from object storage rather than through the Node service is the likely path once the audience grows.

## Design constraints

- **Playback is room-level, not client-level.** Synchronized listening means the track order and current position belong to the room (server-authoritative), and clients join at the room's current track and offset. Random selection therefore cannot live only in the browser, even in the pre-sync milestones — build random playback so it can move to the server without a rewrite.
- **No immediate repeats**: the random pick must never choose the track that just played. Mind the one-track room, where repeating is the only option.
- **Storage behind an interface.** File access goes through one storage abstraction so local disk can be replaced by S3 without touching callers.
- **Tracks have two sources**: uploaded file or external URL. Both validate file type and size; the size limit is not decided yet, so keep it configurable.
- **Admin auth**: every admin action requires authentication. A single shared staff account is acceptable for now; visitor routes stay public.
- **Analytics need events from day one of playback**: room visits and track plays are recorded per room with timestamps so they can be queried by date range.

## MVP order

1. Room data model and storage
2. Room admin API
3. Room selection page
4. Random playback
5. Continuous loop
6. Sync
7. Admin auth and dashboard
8. Volume controls
9. Analytics

## Open questions

Ask rather than guess when work depends on these:

- Expected concurrent listeners per room, and acceptable sync drift (may change the WebSocket default and decides how much clock correction is needed)
- Maximum mp3 file size
