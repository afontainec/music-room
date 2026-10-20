import { describe, expect, it } from 'vitest';
import { ROOM_PALETTE, colourFromId, defaultColour, parseColour, roomColour } from './palette.js';

describe('room palette', () => {
  it('matches docs/design/visual-style.md, in order', () => {
    expect(ROOM_PALETTE).toEqual([
      '#7fbf95',
      '#7fa8e0',
      '#a99be0',
      '#e0ae7f',
      '#e08a84',
      '#6cc4c0',
      '#d9c46a',
      '#d98fb8',
    ]);
  });

  it('accepts palette colours in any case and nothing else', () => {
    expect(parseColour('#7FBF95')).toBe('#7fbf95');
    for (const value of ['#000000', '7fbf95', 'Moss', '', null, undefined, 1]) expect(parseColour(value)).toBeUndefined();
  });

  it('derives a colour from the last 8 hex digits of the id', () => {
    expect(colourFromId('00000000-0000-4000-8000-000000000000')).toBe(ROOM_PALETTE[0]);
    expect(colourFromId('00000000-0000-4000-8000-00000000000b')).toBe(ROOM_PALETTE[3]);
    expect(colourFromId('3f2c1a9e-1234-4abc-9def-0123DEADBEEF')).toBe(ROOM_PALETTE[0xdeadbeef % 8]);
  });

  it('prefers the stored colour', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(roomColour({ id, colour: ROOM_PALETTE[4] })).toBe(ROOM_PALETTE[4]);
    expect(roomColour({ id, colour: null })).toBe(ROOM_PALETTE[0]);
  });

  it('proposes the first unused colour, then the least used, earliest on a tie', () => {
    expect(defaultColour([])).toBe(ROOM_PALETTE[0]);
    expect(defaultColour([ROOM_PALETTE[0], ROOM_PALETTE[2]])).toBe(ROOM_PALETTE[1]);
    expect(defaultColour([...ROOM_PALETTE])).toBe(ROOM_PALETTE[0]);
    expect(defaultColour([...ROOM_PALETTE, ROOM_PALETTE[0], ROOM_PALETTE[1]])).toBe(ROOM_PALETTE[2]);
    expect(defaultColour([...ROOM_PALETTE, ...ROOM_PALETTE.slice(0, 7)])).toBe(ROOM_PALETTE[7]);
  });
});
