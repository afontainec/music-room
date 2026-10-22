import { migration as rooms0001 } from './0001_rooms.js';
import { migration as roomColour0002 } from './0002_room_colour.js';
import { migration as usageEvents0003 } from './0003_usage_events.js';

// drizzle-kit generates no down migrations, so migrations are hand-written up/down pairs.
// One statement per array entry: the drivers send each as a single prepared statement.
export interface Migration {
  name: string;
  up: string[];
  down: string[];
}

// Applied in this order, rolled back in reverse. Append only.
export const migrations: Migration[] = [rooms0001, roomColour0002, usageEvents0003];
