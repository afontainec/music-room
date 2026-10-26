import { useEffect, useRef, type RefObject } from 'react';
import { envelope, levelAt, smooth } from '../audio/loudness';

// Measures how loud the playing layer is, 0 to 1, for the room page's visuals. The audio element
// is never routed through Web Audio: createMediaElementSource outputs silence for tracks added by
// external URL (they redirect to another origin without CORS), follows the element's volume in
// Chromium, and can stop playback with the screen locked on iOS. Instead the track is fetched a
// second time once it plays, decoded off the main thread by an OfflineAudioContext at a low
// sample rate into a small envelope (audio/loudness.ts), and read at the element's position every
// animation frame. The value therefore ignores the visitor's volume and mute, and anything that
// fails (no Web Audio, a cross-origin URL without CORS, an undecodable file) leaves it at 0 while
// the audio plays as before.

type Offline = typeof OfflineAudioContext;
// The lowest rates browsers accept; the envelope only needs loudness, not the high frequencies.
const DECODE_RATES = [8000, 22050, 44100];
const CACHE_SIZE = 16;
const envelopes = new Map<string, Promise<Float32Array | null>>();

function offlineContext(): OfflineAudioContext | null {
  const w = window as unknown as { OfflineAudioContext?: Offline; webkitOfflineAudioContext?: Offline };
  const Context = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Context) return null;
  for (const rate of DECODE_RATES) {
    try {
      return new Context(1, 1, rate);
    } catch {
      // Older Safari refuses low sample rates; try the next one.
    }
  }
  return null;
}

// Older Safari only has the callback form of decodeAudioData; newer browsers return a promise too.
function decode(context: OfflineAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    context.decodeAudioData(data, resolve, reject)?.catch(reject);
  });
}

async function measure(src: string): Promise<Float32Array | null> {
  const context = offlineContext();
  if (!context) return null;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const buffer = await decode(context, await res.arrayBuffer());
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    return envelope(channels, buffer.sampleRate);
  } catch {
    return null;
  }
}

// One envelope per src, shared across layers and rooms (a one-track room replays the same src);
// a failure is cached too, so it is not retried every turn.
function envelopeFor(src: string): Promise<Float32Array | null> {
  let entry = envelopes.get(src);
  if (!entry) {
    entry = measure(src);
    envelopes.set(src, entry);
    if (envelopes.size > CACHE_SIZE) envelopes.delete(envelopes.keys().next().value!);
  }
  return entry;
}

/**
 * Calls `onLevel` with the playing layer's loudness (0 to 1, rounded to hundredths) on every
 * animation frame that changes it: the track's own level at the element's position times `gain`
 * (the fade-in's progress), and 0 while nothing plays (paused, buffering, between layers). The
 * visitor's volume and mute do not change it. The track is fetched only once it starts playing,
 * so measuring never competes with the audio's own loading.
 */
export function useAudioLevel(
  audio: RefObject<HTMLAudioElement>,
  src: string,
  gain: () => number,
  onLevel?: (level: number) => void,
) {
  const levels = useRef<Float32Array | null>(null);
  const report = useRef(onLevel);
  report.current = onLevel;
  const fade = useRef(gain);
  fade.current = gain;

  useEffect(() => {
    const el = audio.current;
    levels.current = null;
    if (!el) return;
    let active = true;
    const load = () => {
      el.removeEventListener('playing', load);
      envelopeFor(src).then((e) => {
        if (active) levels.current = e;
      });
    };
    if (!el.paused) load();
    else el.addEventListener('playing', load);
    return () => {
      active = false;
      el.removeEventListener('playing', load);
    };
  }, [src]);

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let value = 0;
    let shown = -1;
    const tick = (now: number) => {
      const el = audio.current;
      const playing = el && !el.paused && !el.ended && el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
      const target = playing && levels.current ? levelAt(levels.current, el.currentTime) * fade.current() : 0;
      // A hidden tab gets no frames; after one, catch up at once rather than easing from stale.
      value = smooth(value, target, Math.min(now - last, 1000));
      last = now;
      const rounded = Math.round(value * 100) / 100;
      if (rounded !== shown) {
        shown = rounded;
        report.current?.(rounded);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
}
