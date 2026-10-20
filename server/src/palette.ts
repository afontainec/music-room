// The room palette from docs/design/visual-style.md, in its order: Moss, Sky, Lavender, Sand,
// Coral, Teal, Gold, Rose. Order matters for the default and the id-derived fallback.
export const ROOM_PALETTE = [
  '#7fbf95',
  '#7fa8e0',
  '#a99be0',
  '#e0ae7f',
  '#e08a84',
  '#6cc4c0',
  '#d9c46a',
  '#d98fb8',
] as const;

export type RoomColour = (typeof ROOM_PALETTE)[number];

/** The palette colour for a value, case-insensitively, or undefined when it is not one. */
export function parseColour(value: unknown): RoomColour | undefined {
  if (typeof value !== 'string') return undefined;
  const colour = value.trim().toLowerCase();
  return ROOM_PALETTE.find((c) => c === colour);
}

/**
 * The colour of a room without a stored one: the last 8 hex digits of its UUID, as a number,
 * modulo the palette size. Depends only on the id, so other rooms never change it.
 */
export function colourFromId(id: string): RoomColour {
  const n = Number.parseInt(id.replace(/-/g, '').slice(-8), 16);
  return ROOM_PALETTE[(Number.isNaN(n) ? 0 : n) % ROOM_PALETTE.length];
}

/** The colour a room shows: its stored one, else the one derived from its id. */
export function roomColour(room: { id: string; colour: string | null }): RoomColour {
  return parseColour(room.colour) ?? colourFromId(room.id);
}

/**
 * The default for a new room, given the colours existing rooms show: the first palette colour
 * no room uses, else the one the fewest rooms use (the earliest in palette order on a tie).
 */
export function defaultColour(used: readonly string[]): RoomColour {
  const counts = new Map<string, number>(ROOM_PALETTE.map((c) => [c, 0]));
  for (const colour of used) {
    if (counts.has(colour)) counts.set(colour, counts.get(colour)! + 1);
  }
  let best: RoomColour = ROOM_PALETTE[0];
  for (const colour of ROOM_PALETTE) {
    if (counts.get(colour)! < counts.get(best)!) best = colour;
  }
  return best;
}

export const invalidColour = { error: `Colour must be one of the room palette: ${ROOM_PALETTE.join(', ')}` };
