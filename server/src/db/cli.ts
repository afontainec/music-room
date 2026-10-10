import { databaseUrl } from '../config.js';
import { createDb } from './client.js';
import { migrateDown, migrateUp } from './migrate.js';

// Usage: cli.ts up | down [steps]
const [command, arg] = process.argv.slice(2);
const steps = arg === undefined ? 1 : Number(arg);

if ((command !== 'up' && command !== 'down') || !Number.isInteger(steps) || steps < 1) {
  console.error('Usage: up | down [steps]');
  process.exit(1);
}

const { db, close } = createDb(databaseUrl());
try {
  const names = command === 'up' ? await migrateUp(db) : await migrateDown(db, steps);
  const verb = command === 'up' ? 'Applied' : 'Rolled back';
  console.log(names.length ? `${verb}: ${names.join(', ')}` : 'Nothing to do.');
} finally {
  await close();
}
