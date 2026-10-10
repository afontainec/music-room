import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.js';

// Driver-agnostic, so the same code runs on node-postgres and on PGlite in tests.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(databaseUrl: string): { db: Db; close: () => Promise<void> } {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
