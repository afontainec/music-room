// Loudness maths for the room page's level meter (hooks/useAudioLevel.ts). A decoded track
// becomes an envelope: one normalised level per short window, read at the audio element's
// position while it plays. Kept free of DOM APIs so Vitest can check it with synthetic samples
// (server/src/loudness.test.ts).

/** Length of one envelope window: 20 per second, matching the meter's minimum update rate. */
export const WINDOW_SECONDS = 0.05;
/** Levels at or below this many decibels below full scale count as silence (0). */
export const FLOOR_DB = -60;
/** How quickly the meter follows a rise (attack) and a fall (release), as time constants. */
export const ATTACK_MS = 40;
export const RELEASE_MS = 200;

/** Root mean square of `samples[start, end)`, 0 for an empty range. */
export function rms(samples: ArrayLike<number>, start = 0, end = samples.length): number {
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (end - start));
}

/**
 * Maps an RMS amplitude (1 = full scale) to 0..1 on a decibel scale, which follows perceived
 * loudness better than raw amplitude: FLOOR_DB and below is 0, full scale is 1.
 */
export function normalise(amplitude: number): number {
  if (!(amplitude > 0)) return 0;
  const db = 20 * Math.log10(amplitude);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
}

/**
 * One normalised level per window of `windowSeconds`, from the RMS of each window over all
 * channels (their mean power), so a stereo track measures the same as its mono mix of equal channels.
 */
export function envelope(channels: ArrayLike<number>[], sampleRate: number, windowSeconds = WINDOW_SECONDS): Float32Array {
  const length = channels[0]?.length ?? 0;
  const size = Math.max(1, Math.round(sampleRate * windowSeconds));
  const levels = new Float32Array(Math.ceil(length / size));
  for (let w = 0; w < levels.length; w++) {
    const start = w * size;
    const end = Math.min(length, start + size);
    let power = 0;
    for (const channel of channels) power += rms(channel, start, end) ** 2;
    levels[w] = normalise(Math.sqrt(power / channels.length));
  }
  return levels;
}

/** The envelope's level at `seconds` into the track; 0 before the start and after the end. */
export function levelAt(levels: ArrayLike<number>, seconds: number, windowSeconds = WINDOW_SECONDS): number {
  const w = Math.floor(seconds / windowSeconds);
  return w >= 0 && w < levels.length ? levels[w] : 0;
}

/**
 * Moves `current` towards `target` over `elapsedMs`, quickly on the way up and more slowly on
 * the way down, so the value changes smoothly from frame to frame without lagging behind beats.
 */
export function smooth(current: number, target: number, elapsedMs: number): number {
  const tau = target > current ? ATTACK_MS : RELEASE_MS;
  return target + (current - target) * Math.exp(-Math.max(0, elapsedMs) / tau);
}
