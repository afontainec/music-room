# Music Rooms

Named rooms, each playing its own list of mp3s to everyone listening.

## Setup

Requires Node 22 (`.nvmrc`) and Docker for the local database.

```bash
npm ci
cp .env.example .env
docker compose up -d
npm run db:migrate
```

Then run `npm run dev:server` and `npm run dev:web` in two terminals and open the URL Vite prints.

## Database

Postgres, accessed through Drizzle ORM. The schema is in `server/src/db/schema.ts`.

Migrations are hand-written up/down pairs in `server/src/db/migrations`. To add one, create the next numbered file there, append it to the list in `migrations/index.ts`, and update `schema.ts` to match.

- `npm run db:migrate` applies every pending migration
- `npm run db:rollback` rolls back the latest one (`npm run db:rollback -- 2` for the latest two)

Both read `DATABASE_URL` from the environment or from `.env`.

## Tests

- `npm test` runs Vitest. Database tests use in-memory Postgres (PGlite), so they need no running database.
- `npm run test:e2e` runs Playwright (first time: `npx playwright install chromium`).
