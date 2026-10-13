# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Walking skeleton (`GET /api/hello`) plus the database layer: the `rooms` and `room_files` tables, their Drizzle schema and a migration runner. The mp3 file layer (storage interface, upload/URL endpoints, serving) reads and writes `room_files`; the server connects to the database at startup when `DATABASE_URL` is set. The room API and the room selection page are built, and entering a room plays one random track (no continuous loop or sync yet). No auth. The Product, Stack and Design sections below come from the product brief and stack decisions made with the user; correct them when something is built differently.

## Commands

Node 22 (`.nvmrc`). Run from the repo root:

- `npm ci` — install all workspaces
- `npm run dev:server` / `npm run dev:web` — Fastify on port 3000, Vite dev server proxying `/api` to it
- `npm run build` — build `web/` then `server/`
- `npm start` — run the built server, which also serves `web/dist` (one service in production)
- `npm test` — Vitest (server); a single file: `npm test -w server -- src/routes/hello.test.ts`
- `npm run test:e2e` — Playwright; builds and boots the server on port 3100 itself (first time: `npx playwright install chromium`)
- `docker compose up -d` — local Postgres; copy `.env.example` to `.env` for its `DATABASE_URL`
- `npm run db:migrate` / `npm run db:rollback` — apply all pending migrations / roll back the latest (`-- 2` for two)

CI (`.github/workflows/ci.yml`) runs build, Vitest, the migrations (up, down, up) against a Postgres service, and Playwright on every push and PR. Railway reads `railway.json`: its pre-deploy command applies pending migrations with the compiled CLI (`tsx` is a dev dependency) before the new version starts. The Railway service needs `DATABASE_URL` and `STORAGE_DIR` (a path on the volume mount) set.

## Database

- `server/src/db/schema.ts` is the Drizzle schema; `server/src/db/client.ts` exports `createDb` and the driver-agnostic `Db` type.
- Migrations are hand-written up/down pairs in `server/src/db/migrations` (drizzle-kit generates no down migrations), listed in order in `migrations/index.ts` and tracked in the `schema_migrations` table. One SQL statement per array entry. A schema change needs both a new migration and a matching edit to `schema.ts`.
- Database tests (`server/src/db/db.test.ts`) run on PGlite, in-memory Postgres, so `npm test` needs no database. Type new database code against `Db` so it can be tested the same way.

## Files

- `server/src/storage/storage.ts` is the `Storage` interface (put/open/delete by key); `local.ts` is the disk implementation rooted at `STORAGE_DIR`. Swap it for S3 in `index.ts` only.
- `server/src/files.ts` validates uploads (`.mp3` extension, `audio/mpeg`, ID3/frame-sync magic bytes, size up to `MAX_UPLOAD_BYTES`, default 20 MB) and external URLs (http/https ending in `.mp3`). External URLs are referenced, not re-hosted or fetched.
- `server/src/routes/files.ts`: `POST /api/rooms/:roomId/files` (multipart `file`), `POST /api/rooms/:roomId/files/url` (`{ url }`), `GET /api/rooms/:roomId/files`, `GET /api/files/:id` (streams uploads with Range support, redirects URLs). These are registered only when `DATABASE_URL` is set, and are not behind auth yet.
- `server/src/routes/rooms.ts`: `POST /api/rooms` (`{ name }`, 409 on a duplicate name), `GET /api/rooms`, `GET /api/rooms/:id` (room plus its `files`), `GET /api/rooms/:id/next-track?after=<fileId>` (`{ track }`, a random pick from `server/src/playback.ts` that skips `after` unless it is the only track). Files are assigned to a room with the file routes above. Same registration condition, no auth yet. `docs/openapi.yaml` documents all of these; keep it in sync.
- The Playwright web server runs `db:migrate` and needs Postgres (`docker compose up -d` locally).

## Web

- `web/src/router.tsx` is a minimal History API router (`usePathname`, `navigate`, `Link`); `App.tsx` maps paths to pages. The server serves `index.html` for every non-API path, so client routes load directly.
- `/` is the room selection page (`pages/RoomSelection.tsx`), `/rooms/:id` the room page (`pages/RoomPage.tsx`). API calls live in `web/src/api/`.
- The room page asks the server for the next track, passing the room's last played track (kept in `sessionStorage`). `components/AudioPlayer.tsx` tries to autoplay and shows one Play button when the browser blocks it. Headless Chromium blocks autoplay on a direct page load but allows it after the click from the selection page; e2e tests use both paths, with silent mp3s from `e2e/mp3.ts`.

## E2E recordings

Playwright records a video and a trace of every test (`playwright.config.ts`). CI uploads the HTML report as the `playwright-report` artifact and posts a summary with the link on the pull request; view a report with `npx playwright show-report <folder>`.

This recording is how a change is shown to work, so every pull request that changes behaviour must:

- Add or update a Playwright test in `e2e/` for each acceptance criterion of the issue, named after the criterion so the summary reads as a checklist.
- Drive the real UI through `page` wherever the criterion is user-visible; API-only tests produce no video.
- Assert playback through state (the audio element is playing, which track, what position). The video has no sound.
- Run `npm run test:e2e` and get it passing before opening the pull request.

## Pull requests from issues

When you implement an issue in GitHub Actions (an `@claude` comment), open the pull request yourself once the branch is pushed and the tests pass: `gh pr create --base main --head <branch> --title ... --body ...`, with `Closes #<issue number>` in the body. Do not stop at a "Create PR" link; post the link only if `gh pr create` fails, and say why. CI then posts the e2e recording on the pull request.

In that job Postgres is already running: `.github/workflows/claude.yml` starts it as a service on `localhost:5432` and sets `DATABASE_URL`, with dependencies and Chromium installed. Do not try to start Postgres or Docker yourself (those commands are not allowed there); run `npm run test:e2e` directly. If it fails, report the actual error output rather than assuming the database is missing, and do not replace the run with a mocked API.

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
