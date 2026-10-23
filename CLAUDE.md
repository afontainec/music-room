# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Walking skeleton (`GET /api/hello`) plus the database layer: the `rooms` and `room_files` tables, their Drizzle schema and a migration runner. The mp3 file layer (storage interface, upload/URL endpoints, serving) reads and writes `room_files`; the server connects to the database at startup when `DATABASE_URL` is set. The room API and the room selection page are built. Entering a room gets the device a soundscape layer from the server, fades it in, and requests the next layer each time one ends until the visitor leaves; the page keeps the device present with heartbeats and releases its layer on leaving. The server tracks device presence per room in memory. Staff log in with a single shared account; the admin routes (creating rooms, adding and removing tracks) need its token. The staff area (`/admin`) lists and creates rooms; a room's staff page renames and deletes the room and lists, uploads and removes its tracks, and links to a QR code page for the room's public URL. Rooms have a colour from the design palette; staff choose it when creating a room and change it on the room's staff page, and the selection cards and the room page's rings show it. The room page logs each visit and each track play in `usage_events`, and a staff-only report endpoint counts them per room over a date range, which the staff analytics page (`/admin/analytics`) shows. The Product, Stack and Design sections below come from the product brief and stack decisions made with the user; correct them when something is built differently.

## Commands

Node 22 (`.nvmrc`). Run from the repo root:

- `npm ci` — install all workspaces
- `npm run dev:server` / `npm run dev:web` — Fastify on port 3000, Vite dev server proxying `/api` to it
- `npm run build` — build `web/` then `server/`
- `npm start` — run the built server, which also serves `web/dist` (one service in production)
- `npm test` — Vitest (server); a single file: `npm test -w server -- src/routes/hello.test.ts`
- `npm run demo` — record the walkthroughs in `e2e/demo/` (see PR demos below); `npm run demo -- e2e/demo/x.demo.ts` for one
- `npm run test:e2e` — Playwright; builds and boots the server on port 3100 itself (first time: `npx playwright install chromium`)
- `docker compose up -d` — local Postgres; copy `.env.example` to `.env` for its `DATABASE_URL`
- `npm run db:migrate` / `npm run db:rollback` — apply all pending migrations / roll back the latest (`-- 2` for two)

CI (`.github/workflows/ci.yml`) runs build, Vitest, the migrations (up, down, up) against a Postgres service, and Playwright on every push and PR. Railway reads `railway.json`: its pre-deploy command applies pending migrations with the compiled CLI (`tsx` is a dev dependency) before the new version starts. The Railway service needs `DATABASE_URL`, `STORAGE_DIR` (a path on the volume mount), `ADMIN_PASSWORD` and `AUTH_SECRET` set (see Auth).

## Database

- `server/src/db/schema.ts` is the Drizzle schema; `server/src/db/client.ts` exports `createDb` and the driver-agnostic `Db` type.
- Migrations are hand-written up/down pairs in `server/src/db/migrations` (drizzle-kit generates no down migrations), listed in order in `migrations/index.ts` and tracked in the `schema_migrations` table. One SQL statement per array entry. A schema change needs both a new migration and a matching edit to `schema.ts`.
- Database tests (`server/src/db/db.test.ts`) run on PGlite, in-memory Postgres, so `npm test` needs no database. Type new database code against `Db` so it can be tested the same way.

## Files

- `server/src/storage/storage.ts` is the `Storage` interface (put/open/delete by key); `local.ts` is the disk implementation rooted at `STORAGE_DIR`. Swap it for S3 in `index.ts` only.
- `server/src/files.ts` validates uploads (`.mp3` extension, `audio/mpeg`, ID3/frame-sync magic bytes, size up to `MAX_UPLOAD_BYTES`, default 20 MB) and external URLs (http/https ending in `.mp3`). External URLs are referenced, not re-hosted or fetched.
- `server/src/routes/files.ts`: `POST /api/rooms/:roomId/files` (multipart `file`), `POST /api/rooms/:roomId/files/url` (`{ url }`), `GET /api/rooms/:roomId/files` (oldest first, each track plus `name`, its file name without extension via `trackName`, and `url`, the `/api/files/:id` path), `GET /api/files/:id` (streams uploads with Range support, redirects URLs), `DELETE /api/files/:id` (204; removes the track and an upload's stored file). These are registered only when `DATABASE_URL` is set; the two `POST`s and the `DELETE` need a staff token (see Auth).
- `server/src/palette.ts` is the room palette (the 8 colours of `docs/design/visual-style.md`, in order), `defaultColour` (first unused, else least used, earliest on a tie) and `colourFromId` (last 8 hex digits of the UUID modulo 8). `rooms.colour` is nullable: rooms created before colours store none, and the API returns the id-derived colour for them without persisting it, so every room in a response has a palette `colour`. The palette is validated by the API, not a database constraint.
- `server/src/routes/rooms.ts`: `POST /api/rooms` (`{ name, colour? }`, 409 on a duplicate name; without `colour` the server assigns `defaultColour` of the colours rooms show, and a colour outside the palette is a 400), `GET /api/rooms` (each room plus `trackCount`, counted per request with a join on `room_files`, so it follows uploads and removals at once), `GET /api/rooms/:id` (room plus its `files`), `GET /api/rooms/:id/next-track?after=<fileId>` (`{ track }`, a random pick from `server/src/playback.ts` that skips `after` unless it is the only track), `PATCH /api/rooms/:id` (`{ name?, colour? }`, name required unless only the colour changes, same validation as create; 409 comes from the unique constraint), `DELETE /api/rooms/:id` (204: deletes the room and its `room_files` in one transaction that locks the room row first, so a concurrent upload cannot slip in; after the commit it deletes the uploaded blobs and clears the room's presence, logging any blob it cannot delete instead of failing). Files are assigned to a room with the file routes above. Same registration condition; `POST`, `PATCH` and `DELETE /api/rooms` and the room list (`GET /api/rooms`) need a staff token, while `GET /api/rooms/:id` stays public so visitors open a room from its link. `docs/openapi.yaml` documents all of these; keep it in sync.
- `server/src/presence.ts` is the in-memory presence store (`heartbeat`, `leave`, `present` per room, injectable clock, one shared sweep timer). A device stops counting as present 30 s after its last heartbeat (`present` filters on read; the 5 s sweep frees memory). One instance per app, created in `app.ts` (injectable via `AppDeps.presence`) and stopped on close; state is lost on restart and assumes a single replica. `server/src/routes/presence.ts`: `POST /api/rooms/:id/presence/heartbeat` (`{ deviceId, trackId? }`), `GET /api/rooms/:id/presence` (`{ devices }`), `DELETE /api/rooms/:id/presence/:deviceId` (204, or 404 when not present). The room page sends them (see Web).
- `server/src/routes/layers.ts`: `POST /api/rooms/:id/layer` (`{ deviceId, previousTrackId? }`) assigns a device its layer with `pickLeastUsedTrack` (`playback.ts`): the track fewest other present devices play, random tie-break, never `previousTrackId` (defaulting to the device's current presence track) unless the room has one track. It records the pick as the device's heartbeat and returns `{ track: { id, name, url } }`, or `{ track: null, reason: 'no-tracks', message }` for an empty room. Reading presence, picking and recording run without an `await` in between, so concurrent requests cannot race on the counts. The no-repeat rule wins over balance, so a device leaving the least-used track can briefly widen the spread. The web room page plays what it assigns; `next-track` is no longer used by the web app.
- `server/src/routes/analytics.ts`: `POST /api/rooms/:id/visits` (`{ deviceId }`) and `POST /api/rooms/:id/plays` (`{ deviceId, trackId }`, 404 unless the track is in that room) insert a row in `usage_events` (`type` `visit` or `play`, `room_id`, `track_id`, `device_id`, `occurred_at` set by the database, indexed on `room_id, occurred_at`) and answer 204; both are public, since visitors send them. `GET /api/analytics/rooms?from=&to=` (staff) returns `{ from, to, rooms }`, every room by name with `visits`, `visitors` (distinct device ids among the visits) and `plays`, zeros included. Bounds are UTC: a `YYYY-MM-DD` date or a date-time with an explicit offset (`parseBound`); `from` is inclusive, `to` exclusive except that a date-only `to` covers that whole day; a bad bound or `from >= to` is a 400. Visits are counted per room entry, not deduplicated. Deleting a room deletes its events; removing a track keeps its plays with `track_id` null.
- The Playwright web server runs `db:migrate` and needs Postgres (`docker compose up -d` locally).

## Auth

- `server/src/auth.ts` (`Auth`): one shared staff account from `ADMIN_USERNAME` (default `staff`) and `ADMIN_PASSWORD`; without a password login answers 503 and every admin route 401. Tokens are stateless, `<base64url {sub, exp}>.<HMAC-SHA256>` keyed by `AUTH_SECRET` (random per process when unset, so sessions end on restart), valid for `AUTH_TOKEN_TTL_SECONDS` (default 12 h). No refresh and no server-side revocation: logging out forgets the token in the browser, and staff log in again after expiry. No dependencies beyond `node:crypto`.
- `server/src/routes/auth.ts`: `POST /api/auth/login` (`{ username, password }` → `{ token, expiresAt }`, 401 on wrong credentials), `GET /api/auth/session` (the token's `{ username, expiresAt }`).
- Admin routes take `preHandler: auth.requireAdmin` (passed to the route plugins as `requireAdmin`), which answers 401 with `WWW-Authenticate: Bearer` unless the request has `Authorization: Bearer <token>`; an expired token gets `Session expired, log in again`. Put it on every new admin route; visitor routes (a single room, its tracks, playback, presence, layers) stay public. The full room list is staff only. `AppDeps.auth` is required.
- Tests: `server/src/test/admin.ts` (`testAuth`, `adminHeaders`; excluded from the build) and `e2e/admin.ts` (`adminHeaders(request)` logs in with the account `playwright.config.ts` gives the test server; `signToken` forges tokens with its `AUTH_SECRET`, e.g. expired ones).
- Not built: login rate limiting, multiple accounts, password reset.

## Web

- `web/src/router.tsx` is a minimal History API router (`usePathname`, `navigate`, `Link`); `App.tsx` maps paths to pages. The server serves `index.html` for every non-API path, so client routes load directly.
- `/` is the room selection page (`pages/RoomSelection.tsx`, "Where are you?": a grid of cards, each one link named by the room, with a glowing dot in the room's `colour` and its layer count from `trackCount` as the link's description; errors offer a "Try again" button; it sends the staff token when one is stored, and on a 401 shows visitors an "Ask for a room link" message and a staff login link instead of the list, with no room names in the page; while loading it shows nothing room-related), `/rooms/:id` the room page (`pages/RoomPage.tsx` and `RoomPage.css`, the "Mono" look: a centred column up to 480px with a top bar (back link, the room name as the `h1` label), the concentric rings of `components/RoomRings.tsx`, whose inner ring, centre dot and glow take the room's `colour` through `--room-colour` and whose inner ring pulses slowly only under `prefers-reduced-motion: no-preference`, then the "Your layer" label and the layer name (`.layer-name`, 48px light), with empty space kept below for the volume controls; it reads the room once on entry, so a staff edit shows after a reload; it links to no other room for visitors, so they stay in the room their link opened; staff with a valid session get a "← Rooms" link to `/` (the arrow is a decorative icon, so the link is named "Rooms"), from `hooks/useOptionalStaffSession.ts`, which never redirects, makes no request without a token, and re-checks on token changes in any tab (`onTokenChange` in `api/auth.ts`), on returning to view and at the token's expiry, so the link disappears on logout or expiry without a reload), `/admin/login` the staff login (`pages/StaffLogin.tsx`), `/admin/analytics` the usage report (`pages/Analytics.tsx`: "From" and "To" date inputs, UTC days with both ends included, starting on the last 30 days and fetched again on every change, an empty date leaving that end open and a start after the end refused in the page without a request; then a "Per room" table of every room with its visits, visitors and plays and an "All rooms" total of visits and plays; it links back to the staff area) and `/admin` the staff area (`pages/StaffArea.tsx`, an "Analytics" link beside "Log out", the list of rooms and a create-room form with a "New room colour" picker pre-selecting `defaultColour` of the listed rooms' colours until staff pick another, sending the shown colour, or none while the list is unavailable; the list is fetched again after a create) and `/admin/rooms/:id` a room in it (`pages/AdminRoomPage.tsx`: a "QR code" link under the name to `/admin/rooms/:id/qrcode` (`pages/AdminRoomQrPage.tsx`, staff gated like the other staff pages: the room name as the `h1`, a QR code of the room's public URL `${location.origin}/rooms/:id` drawn client-side on a canvas with the `qrcode` package, black on white with a quiet zone, and the URL as a selectable link below it; e2e tests decode it with `jsqr`), a rename form, the current colour with a "Room colour" picker and a "Save colour" button (`PATCH` with only `colour`; saved with a button rather than on change, so arrow keys do not send a request per swatch), and a confirmed "Delete room" button that returns to `/admin`, an "Add a track" radio group choosing between the upload form ("Upload file", the default) and a URL form ("Add by URL", `noValidate` so the server's reason is shown, submit disabled while empty or adding, a success status after adding), and `components/TrackList.tsx`, the room's tracks with loading, error-with-retry and empty states and a confirmed remove button each; the list is fetched again after every addition or removal). Staff pages gate on `hooks/useStaffSession.ts`, which checks the stored token with `GET /api/auth/session` and sends staff to the login without a valid one. `components/ColourPicker.tsx` is the palette as a fieldset of visually hidden native radios (named after the colour, e.g. "Moss"), disabled as a whole while a request is in flight; `web/src/palette.ts` is the web copy of the palette with names, `defaultColour` and `colourName`, kept equal to `server/src/palette.ts` by `server/src/palette.test.ts`. API calls live in `web/src/api/`; `api/auth.ts` keeps the staff token in `localStorage` and `authHeaders()` adds it to admin calls; `api/admin.ts` holds the staff room and track calls (rejecting with the server's `error` message, e.g. a duplicate name) and on a 401 clears the token and throws `SessionExpiredError`, on which the page sends staff to the login.
- The room page plays layers through `hooks/useSoundscapeLayer.ts`: it keeps a device id per tab (`sessionStorage`, so two tabs are two devices), calls `POST /layer` on entry (passing the room's last played track as `previousTrackId`) and again on `ended` (passing the layer that ended), retries a failed request every 3 s, sends a heartbeat every 10 s (a third of the 30 s presence timeout), and releases the layer (`DELETE` presence with `keepalive`) on unmount and `pagehide`. Returning to view (`visibilitychange`, bfcache `pageshow`) sends a heartbeat at once and retries a pending request. The next layer is requested when one ends, not prefetched, since requesting records it as the device's track. The `turn` counter lets a one-track room replay the same src. It records a visit (`recordVisit`) on entry, and `played` records a play, which the room page calls from `AudioPlayer`'s `onStarted` (once per layer, on its first `playing`, so a blocked autoplay or a resume after a pause is not a play); both are fire-and-forget.
- `components/AudioPlayer.tsx` reuses one audio element for every layer, tries to autoplay and shows one "Tap to listen" button (native `<button>`, so Enter/Space work; `:focus-visible` outline; the full-width 52px primary pill below the layer name) when `play()` is rejected, hiding it once the layer plays. An `AbortError` from `play()` (a new src or a pause interrupted it) does not show the button, to avoid false positives. Each layer starts at volume 0 and fades in linearly over `FADE_IN_MS` (3 s) from its `playing` event, time-based so throttled background timers still finish on time (iOS ignores `volume`). On returning to view it resumes a track the OS paused, but not one the visitor paused from the lock screen (Media Session `pause` handler); it also sets Media Session metadata (layer name, room name).
- Headless Chromium blocks autoplay on a direct page load but allows it after the click from the selection page; e2e tests use both paths, with silent mp3s from `e2e/mp3.ts` and shared helpers in `e2e/room.ts` (`shownLayer` is the layer name on the page; `enterRoom` gives the page a staff session with `asStaff` from `e2e/admin.ts`, since the room list is staff only). Headless pages never become hidden, so `e2e/soundscape.spec.ts` overrides `document.visibilityState` and fires `visibilitychange` to cover backgrounding; it checks fades through logged `volumechange` events and uses two browser contexts for two devices.

## E2E tests

Playwright keeps a video and a trace only for failed tests (`playwright.config.ts`). CI uploads the HTML report as the `playwright-report` artifact and posts a pass/fail summary on the pull request.

Every pull request that changes behaviour must:

- Add or update a Playwright test in `e2e/` for each acceptance criterion of the issue, named after the criterion so the summary reads as a checklist.
- Assert playback through state (the audio element is playing, which track, what position). Recordings have no sound.
- Run `npm run test:e2e` and get it passing before opening the pull request.

## PR demos

Each behaviour-changing pull request also includes a screencast: a demo script in `e2e/demo/<feature>.demo.ts` that walks through the feature in the real UI, the way a person would show it on their local server. The Demo workflow (`.github/workflows/demo.yml`) records only the demos the pull request adds or changes, converts them to an MP4 and a GIF, stores them on the `pr-media` branch and posts one comment with the GIF inline. `soundscape-setup.demo.ts` is the reference example.

- Import `test`, `caption`, `click` and `typeInto` from `e2e/demo/screencast.ts`: they draw a visible cursor, glide to each element and type at reading speed. Use plain Playwright calls only for steps viewers need not watch (setting up data, uploads).
- Show the main flow of the issue in under 60 seconds, with a `caption` before each step saying what is happening in plain words.
- Use one `page` per demo: each page is a separate video. To show a second device, call the API from the same test and caption the result.
- End on the outcome, and assert it with `expect` so the demo fails if the feature does not work.
- Run `npm run demo -- e2e/demo/<feature>.demo.ts` before opening the pull request.

## Pull requests from issues

When you implement an issue in GitHub Actions (an `@claude` comment), open the pull request yourself once the branch is pushed and the tests pass: `gh pr create --base main --head <branch> --title ... --body ...`, with `Closes #<issue number>` in the body. Do not stop at a "Create PR" link; post the link only if `gh pr create` fails, and say why. CI then posts the e2e recording on the pull request.

In that job Postgres is already running: `.github/workflows/claude.yml` starts it as a service on `localhost:5432` and sets `DATABASE_URL`, with dependencies and Chromium installed. Do not try to start Postgres or Docker yourself (those commands are not allowed there); run `npm run test:e2e` directly. If it fails, report the actual error output rather than assuming the database is missing, and do not replace the run with a mocked API.

## Product

Music Rooms is a web app with named "rooms", each holding its own list of mp3 files. Each room is a soundscape (for example a forest) and its tracks are the layers: birds, wind, a water stream, forest-inspired music. Visitors are usually together in one physical space, each with a phone on speaker, and each device plays one layer, so the devices together make up the scene. Devices in a room play different tracks, not the same one.

Three audiences:

- **Visitors** (desktop and mobile browsers, no login): choose a room, listen to the layer their device is given (they see its name but cannot choose it), control their own volume and mute.
- **Staff/admins** (logged in): create, rename and delete rooms; upload, list and remove mp3s per room. Changes must show up immediately in the public app.
- **Owner**: basic analytics — room visits and track plays per room, filterable by date range.

## Stack

Confirmed:

- **Backend**: Node.js with Fastify and TypeScript
- **Frontend**: React + TypeScript single-page app built with Vite; the public player and the admin dashboard are routes in the same app
- **Database**: Postgres, accessed through Drizzle ORM (schema and migrations in TypeScript)
- **Repo layout**: npm workspaces with `server/` and `web/` packages
- **Tests**: Vitest
- **Realtime transport**: not needed for the soundscape model; layer assignment is request/response plus a presence heartbeat. Add WebSockets only if a later feature needs push
- **Hosting**: Railway — one long-running Node service, managed Postgres, and a persistent volume for mp3s
- **Mp3 storage**: local disk (the Railway volume) for the MVP, to be swapped for S3-compatible object storage later

Hosting consequences to design around:

- A volume attaches to a single instance, so the app runs as one replica until mp3s move to object storage. Don't rely on horizontal scaling or zero-downtime deploys before then.
- Railway's Hobby plan caps a volume at 5 GB (about 1,000 tracks at 5 MB each, across all rooms).
- Audio streaming is billed as network egress, so serving mp3s from object storage rather than through the Node service is the likely path once the audience grows.

## Design constraints

- **One layer per device, assigned by the server.** When a device joins or its track ends, the server gives it the room's least-used track among the devices currently present (tracked with a heartbeat), so layers spread across devices before any repeats. Assignment cannot live only in the browser, because a device cannot see what the others are playing. Each device plays exactly one layer, even when only one or two people are in the room.
- **No immediate repeats**: a device's next layer must never be the track it just played. Mind the one-track room, where repeating is the only option.
- **Loose timing, no clock sync.** Devices switch layers independently when their own track ends, and each layer fades in over a few seconds wherever it starts. A few seconds' offset between devices is acceptable; there is no shared timeline, drift correction or beat alignment. Beat-aligned entry for musical layers may come later (a BPM per room set by staff, tracks tagged musical or ambient).
- **Autoplay will be blocked.** Browsers block sound until a tap, so the player must show a clear "Tap to listen" control, and should keep playing with the screen locked where the browser allows.
- **Storage behind an interface.** File access goes through one storage abstraction so local disk can be replaced by S3 without touching callers.
- **Tracks have two sources**: uploaded file or external URL. Both validate file type and size; the size limit is not decided yet, so keep it configurable.
- **Admin auth**: every admin action requires authentication. A single shared staff account is acceptable for now; visitor routes stay public.
- **Visual style**: `docs/design/visual-style.md` is the agreed look (dark, Geist, one colour per room from a fixed palette), with mockups and their tokens in `docs/design/`. `web/src/tokens.css` defines the tokens once for the whole app (colours, room palette, fonts, radii, the dark `body`, `.label`/`.title`/`.body-text`, focus outlines); Geist is loaded from Google Fonts in `web/index.html`. The room selection page (`pages/RoomSelection.css`) and the room page (`pages/RoomPage.css`) are restyled, and so are the staff login, room list and analytics page (`pages/Staff.css`: forms and the room list on `--surface` cards, `--surface-raised` inputs, a `--text` pill primary button, each room row with a flat dot in its colour and the colour's name as the link's description); a room's staff page still uses the old layout in `web/src/styles.css`, mapped onto the dark tokens, until its own restyle.
- **Analytics need events from day one of playback**: room visits and track plays are recorded per room with timestamps so they can be queried by date range (built: `usage_events`, `GET /api/analytics/rooms` and the `/admin/analytics` page).

## MVP order

1. Room data model and storage
2. Room admin API
3. Room selection page
4. Random playback
5. Continuous loop
6. Soundscape layer assignment
7. Admin auth and dashboard
8. Volume controls
9. Analytics

## Open questions

Ask rather than guess when work depends on these:

- Maximum mp3 file size

Decided with the user: 10 to 100 devices per room, a few seconds of timing offset between devices is acceptable, and two devices may share a layer only once every layer is in use.
