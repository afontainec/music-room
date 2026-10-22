// The room palette from docs/design/visual-style.md, in its order. The server validates colours
// against the same list (server/src/palette.ts); server/src/palette.test.ts keeps the two in sync.
export const ROOM_PALETTE = [
  { name: 'Moss', value: '#7fbf95' },
  { name: 'Sky', value: '#7fa8e0' },
  { name: 'Lavender', value: '#a99be0' },
  { name: 'Sand', value: '#e0ae7f' },
  { name: 'Coral', value: '#e08a84' },
  { name: 'Teal', value: '#6cc4c0' },
  { name: 'Gold', value: '#d9c46a' },
  { name: 'Rose', value: '#d98fb8' },
] as const;

/** The palette name of a colour ("Moss"), or the value itself when it is not in the palette. */
export const colourName = (value: string) =>
  ROOM_PALETTE.find((c) => c.value === value.toLowerCase())?.name ?? value;

/**
 * The colour the server gives a new room without one, given the colours existing rooms show: the
 * first palette colour no room uses, else the one the fewest rooms use (the earliest on a tie).
 */
export function defaultColour(used: readonly string[]): string {
  const counts = new Map<string, number>(ROOM_PALETTE.map((c) => [c.value, 0]));
  for (const colour of used) {
    const key = colour.toLowerCase();
    if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
  }
  let best: string = ROOM_PALETTE[0].value;
  for (const { value } of ROOM_PALETTE) {
    if (counts.get(value)! < counts.get(best)!) best = value;
  }
  return best;
}
