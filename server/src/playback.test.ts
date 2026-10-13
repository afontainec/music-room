import { describe, expect, it } from 'vitest';
import { pickNextTrack } from './playback.js';

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
