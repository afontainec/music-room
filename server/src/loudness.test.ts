import { describe, expect, it } from 'vitest';
import {
  FLOOR_DB,
  WINDOW_SECONDS,
  envelope,
  levelAt,
  normalise,
  rms,
  smooth,
} from '../../web/src/audio/loudness.js';

// The room page's level meter lives in web/, which has no test runner; its maths is plain
// TypeScript, so it is checked here like the web palette is.

const RATE = 8000;

function tone(seconds: number, amplitude: number, hz = 440): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE);
  return out;
}

const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

describe('rms', () => {
  it('is 0 for silence and an empty range', () => {
    expect(rms(new Float32Array(100))).toBe(0);
    expect(rms(new Float32Array(100), 50, 50)).toBe(0);
  });

  it('is the amplitude of a constant signal and amplitude/√2 for a sine', () => {
    expect(rms(new Float32Array(64).fill(-0.5))).toBeCloseTo(0.5);
    expect(rms(tone(1, 0.8))).toBeCloseTo(0.8 / Math.SQRT2, 3);
  });

  it('measures only the given range', () => {
    const s = concat(new Float32Array(10), new Float32Array(10).fill(1));
    expect(rms(s, 0, 10)).toBe(0);
    expect(rms(s, 10, 20)).toBe(1);
  });
});

describe('normalise', () => {
  it('maps silence and the floor to 0 and full scale to 1', () => {
    expect(normalise(0)).toBe(0);
    expect(normalise(Number.NaN)).toBe(0);
    expect(normalise(10 ** (FLOOR_DB / 20))).toBeCloseTo(0);
    expect(normalise(10 ** ((FLOOR_DB - 20) / 20))).toBe(0);
    expect(normalise(1)).toBe(1);
    expect(normalise(2)).toBe(1);
  });

  it('is linear in decibels: half way is 30 dB down', () => {
    expect(normalise(10 ** (-30 / 20))).toBeCloseTo(0.5);
  });

  it('rises with amplitude', () => {
    const levels = [0.001, 0.01, 0.1, 0.5, 1].map(normalise);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
  });
});

describe('envelope', () => {
  it('has one level per window, the last one partial', () => {
    expect(envelope([new Float32Array(RATE)], RATE)).toHaveLength(1 / WINDOW_SECONDS);
    expect(envelope([new Float32Array(RATE + 1)], RATE)).toHaveLength(1 / WINDOW_SECONDS + 1);
    expect(envelope([new Float32Array(0)], RATE)).toHaveLength(0);
  });

  it('is near 0 in silence and higher for louder passages', () => {
    const levels = envelope([concat(new Float32Array(RATE), tone(1, 0.05), tone(1, 0.8))], RATE);
    const at = (s: number) => levelAt(levels, s);
    expect(at(0.5)).toBe(0);
    expect(at(1.5)).toBeGreaterThan(0.3);
    expect(at(2.5)).toBeGreaterThan(at(1.5) + 0.3);
    expect(at(2.5)).toBeCloseTo(normalise(0.8 / Math.SQRT2), 2);
  });

  it('measures stereo as the mean power of its channels', () => {
    const left = tone(1, 0.5);
    expect(envelope([left, left], RATE)[3]).toBeCloseTo(envelope([left], RATE)[3]);
    const [one] = envelope([left, new Float32Array(left.length)], RATE);
    expect(one).toBeCloseTo(normalise(Math.sqrt((0.5 / Math.SQRT2) ** 2 / 2)), 2);
  });
});

describe('levelAt', () => {
  const levels = Float32Array.from([0.1, 0.2, 0.3]);

  it('reads the window holding the position', () => {
    expect(levelAt(levels, 0)).toBeCloseTo(0.1);
    expect(levelAt(levels, WINDOW_SECONDS * 1.5)).toBeCloseTo(0.2);
    expect(levelAt(levels, WINDOW_SECONDS * 2.99)).toBeCloseTo(0.3);
  });

  it('is 0 outside the track', () => {
    expect(levelAt(levels, -1)).toBe(0);
    expect(levelAt(levels, WINDOW_SECONDS * 3)).toBe(0);
  });
});

describe('smooth', () => {
  it('stays put with no time elapsed and reaches the target eventually', () => {
    expect(smooth(0.2, 0.9, 0)).toBeCloseTo(0.2);
    expect(smooth(0.2, 0.9, 10_000)).toBeCloseTo(0.9);
    expect(smooth(0.9, 0, 10_000)).toBeCloseTo(0);
  });

  it('rises faster than it falls', () => {
    const up = smooth(0, 1, 50);
    const down = 1 - smooth(1, 0, 50);
    expect(up).toBeGreaterThan(down);
  });

  it('moves part of the way per animation frame, never past the target', () => {
    let v = 0;
    for (let i = 0; i < 10; i++) {
      const next = smooth(v, 1, 16);
      expect(next).toBeGreaterThan(v);
      expect(next).toBeLessThanOrEqual(1);
      v = next;
    }
  });
});
