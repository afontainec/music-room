import { describe, expect, it } from 'vitest';
import { pickLeastUsedTrack, pickNextTrack } from './playback.js';

const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('pickNextTrack', () => {
  it('returns undefined for an empty room', () => {
    expect(pickNextTrack([], 'a')).toBeUndefined();
  });

  it('picks uniformly from every track when nothing has played yet', () => {
    expect(pickNextTrack(tracks, null, () => 0)?.id).toBe('a');
    expect(pickNextTrack(tracks, null, () => 0.5)?.id).toBe('b');
    expect(pickNextTrack(tracks, null, () => 0.999)?.id).toBe('c');
  });

  it('never picks the track that just played when there is more than one', () => {
    for (const previous of tracks) {
      for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
        expect(pickNextTrack(tracks, previous.id, () => r)?.id).not.toBe(previous.id);
      }
    }
    expect(pickNextTrack([{ id: 'a' }, { id: 'b' }], 'a', () => 0.999)?.id).toBe('b');
  });

  it('repeats the only track of a one-track room', () => {
    expect(pickNextTrack([{ id: 'a' }], 'a')?.id).toBe('a');
  });

  it('ignores a previous id that is no longer in the room', () => {
    expect(pickNextTrack(tracks, 'gone', () => 0.999)?.id).toBe('c');
  });
});

describe('pickLeastUsedTrack', () => {
  const counts = (entries: Record<string, number> = {}) => new Map(Object.entries(entries));

  it('returns undefined for an empty room', () => {
    expect(pickLeastUsedTrack([], counts(), 'a')).toBeUndefined();
  });

  it('picks the least-used track', () => {
    expect(pickLeastUsedTrack(tracks, counts({ a: 1, c: 1 }), null, () => 0.999)?.id).toBe('b');
    expect(pickLeastUsedTrack(tracks, counts({ a: 3, b: 2, c: 2 }), null, () => 0)?.id).toBe('b');
  });

  it('breaks ties at random among the least-used tracks', () => {
    const used = counts({ a: 2, b: 1, c: 1 });
    expect(pickLeastUsedTrack(tracks, used, null, () => 0)?.id).toBe('b');
    expect(pickLeastUsedTrack(tracks, used, null, () => 0.999)?.id).toBe('c');
  });

  it('gives N devices N different tracks, then spreads the rest evenly', () => {
    const used = counts();
    const assigned: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = pickLeastUsedTrack(tracks, used, null, () => (i * 0.37) % 1)!.id;
      used.set(id, (used.get(id) ?? 0) + 1);
      assigned.push(id);
      const values = tracks.map((t) => used.get(t.id) ?? 0);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
    expect(new Set(assigned.slice(0, tracks.length)).size).toBe(tracks.length);
  });

  it('never picks the previous track, even when it is the least used', () => {
    for (const r of [0, 0.5, 0.999]) {
      expect(pickLeastUsedTrack(tracks, counts({ b: 4, c: 4 }), 'a', () => r)?.id).not.toBe('a');
    }
    expect(pickLeastUsedTrack([{ id: 'a' }, { id: 'b' }], counts({ b: 9 }), 'a')?.id).toBe('b');
  });

  it('repeats the only track of a one-track room', () => {
    expect(pickLeastUsedTrack([{ id: 'a' }], counts({ a: 5 }), 'a')?.id).toBe('a');
  });
});
