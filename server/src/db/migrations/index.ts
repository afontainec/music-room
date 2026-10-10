import { migration as rooms0001 } from './0001_rooms.js';

// drizzle-kit generates no down migrations, so migrations are hand-written up/down pairs.
// One statement per array entry: the drivers send each as a single prepared statement.
export interface Migration {
  name: string;
  up: string[];
  down: string[];
}

// Applied in this order, rolled back in reverse. Append only.
export const migrations: Migration[] = [rooms0001];
