import { eq, sql } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Db } from './client.js';
import { migrations as allMigrations, type Migration } from './migrations/index.js';

const schemaMigrations = pgTable('schema_migrations', {
  name: text('name').primaryKey(),
  appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});

async function appliedNames(db: Db): Promise<Set<string>> {
  await db.execute(
    sql`create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`,
  );
  const rows = await db.select({ name: schemaMigrations.name }).from(schemaMigrations);
  return new Set(rows.map((r) => r.name));
}

/** Applies every pending migration, each in its own transaction. Returns the names applied. */
export async function migrateUp(db: Db, migrations: Migration[] = allMigrations): Promise<string[]> {
  const applied = await appliedNames(db);
  const ran: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    await db.transaction(async (tx) => {
      for (const statement of migration.up) await tx.execute(sql.raw(statement));
      await tx.insert(schemaMigrations).values({ name: migration.name });
    });
    ran.push(migration.name);
  }
  return ran;
}

/** Rolls back the most recently applied migrations, newest first. Returns the names rolled back. */
export async function migrateDown(
  db: Db,
  steps = 1,
  migrations: Migration[] = allMigrations,
): Promise<string[]> {
  const applied = await appliedNames(db);
  const toRevert = migrations
    .filter((m) => applied.has(m.name))
    .reverse()
    .slice(0, steps);
  for (const migration of toRevert) {
    await db.transaction(async (tx) => {
      for (const statement of migration.down) await tx.execute(sql.raw(statement));
      await tx.delete(schemaMigrations).where(eq(schemaMigrations.name, migration.name));
    });
  }
  return toRevert.map((m) => m.name);
}
