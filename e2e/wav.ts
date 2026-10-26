// Audio with real sound for the level meter's tests: a mono 16-bit WAV of 440 Hz tone segments.
// Uploads must be mp3s and nothing here encodes mp3, so tests upload a silent mp3 and serve this
// in its place with page.route (see e2e/audio-level.spec.ts); browsers play and decode WAV alike.
const RATE = 8000;

export interface Segment {
  seconds: number;
  /** Peak amplitude, 0 (silence) to 1 (full scale). */
  amplitude: number;
  /** Swings the amplitude between `amplitude` and `low` this many times per second. */
  wobble?: { hz: number; low: number };
}

export function toneWav(segments: Segment[]): Buffer {
  const total = segments.reduce((n, s) => n + Math.round(s.seconds * RATE), 0);
  const wav = Buffer.alloc(44 + total * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + total * 2, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(RATE, 24);
  wav.writeUInt32LE(RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(total * 2, 40);
  let i = 0;
  for (const s of segments) {
    const n = Math.round(s.seconds * RATE);
    for (let k = 0; k < n; k++, i++) {
      const t = i / RATE;
      let amplitude = s.amplitude;
      if (s.wobble) amplitude = s.wobble.low + ((s.amplitude - s.wobble.low) * (1 + Math.sin(2 * Math.PI * s.wobble.hz * t))) / 2;
      const sample = amplitude * Math.sin(2 * Math.PI * 440 * t);
      wav.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
    }
  }
  return wav;
}
