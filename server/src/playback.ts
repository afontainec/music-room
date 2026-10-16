/**
 * Picks a random track, never the one that just played unless it is the only one.
 * The random source is injectable so the choice can be tested deterministically.
 */
export function pickNextTrack<T extends { id: string }>(
  tracks: readonly T[],
  previousId?: string | null,
  random: () => number = Math.random,
): T | undefined {
  const candidates = tracks.length > 1 ? tracks.filter((t) => t.id !== previousId) : tracks;
  return candidates[Math.floor(random() * candidates.length)];
}

/**
 * Picks a device's soundscape layer: the track played by the fewest other devices, so every
 * track is in use once before any plays on two devices. Never the device's previous track unless
 * it is the room's only one. Ties are broken at random (injectable, as above).
 * `counts` maps track ids to how many other present devices play them; missing ids count as zero.
 */
export function pickLeastUsedTrack<T extends { id: string }>(
  tracks: readonly T[],
  counts: ReadonlyMap<string, number>,
  previousId?: string | null,
  random: () => number = Math.random,
): T | undefined {
  const candidates = tracks.length > 1 ? tracks.filter((t) => t.id !== previousId) : tracks;
  const usage = (t: T) => counts.get(t.id) ?? 0;
  const least = Math.min(...candidates.map(usage));
  const tied = candidates.filter((t) => usage(t) === least);
  return tied[Math.floor(random() * tied.length)];
}
