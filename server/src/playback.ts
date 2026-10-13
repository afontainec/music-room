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
