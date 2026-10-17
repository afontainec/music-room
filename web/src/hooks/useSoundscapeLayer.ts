import { useCallback, useEffect, useRef, useState } from 'react';
import { NotFoundError, releaseLayer, requestLayer, sendHeartbeat, type Layer } from '../api/rooms';

// A third of the server's 30 s presence timeout, so one lost heartbeat does not drop the device.
export const HEARTBEAT_MS = 10_000;
// A failed layer request is retried this often, and right away when the page returns to view.
const RETRY_MS = 3_000;

export type LayerState =
  | { status: 'loading' }
  | { status: 'not-found' }
  // `turn` counts the layers assigned, so a one-track room can replay the same file.
  | { status: 'ready'; layer: Layer | null; turn: number };

// One id per tab, kept across reloads: each open room page is one listening device, so two
// tabs on the same phone are two devices rather than one that keeps releasing the other.
const DEVICE_KEY = 'music-room:device-id';

function newDeviceId() {
  // getRandomValues, unlike randomUUID, also works on plain http (a phone on the LAN dev server).
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function deviceId(): string {
  try {
    let id = sessionStorage.getItem(DEVICE_KEY);
    if (!id) sessionStorage.setItem(DEVICE_KEY, (id = newDeviceId()));
    return id;
  } catch {
    return (memoryDeviceId ??= newDeviceId()); // storage disabled, e.g. some private browsing modes
  }
}
let memoryDeviceId: string | undefined;

// The last layer played per room, kept for the tab's session so re-entering a room (which
// released the previous layer) does not start with the same track again.
const lastPlayedKey = (roomId: string) => `music-room:last-played:${roomId}`;

function readLastPlayed(roomId: string): string | null {
  try {
    return sessionStorage.getItem(lastPlayedKey(roomId));
  } catch {
    return null;
  }
}

function writeLastPlayed(roomId: string, trackId: string) {
  try {
    sessionStorage.setItem(lastPlayedKey(roomId), trackId);
  } catch {
    // Without storage the next visit may repeat the track; playback still works.
  }
}

// Counts the visits to each room in this tab, so a late answer from an earlier visit can tell
// whether a newer one now owns the device's presence.
const latestSession = new Map<string, number>();

// Gets this device its layer in the room and the next one each time `next()` is called (when
// the layer ends), keeps the device present with heartbeats while the page is open, and
// releases the layer when the visitor leaves or the page closes. The server picks every
// layer, since only it knows what the other devices are playing.
export function useSoundscapeLayer(roomId: string) {
  const [state, setState] = useState<LayerState>({ status: 'loading' });
  const nextRef = useRef<() => void>(() => {});

  useEffect(() => {
    const device = deviceId();
    const session = (latestSession.get(roomId) ?? 0) + 1;
    latestSession.set(roomId, session);
    let active = true;
    let layer: Layer | null = null;
    let pending = false;
    let retry: { timer: number; run: () => void } | null = null;

    const assign = (previous: string | null) => {
      pending = true;
      requestLayer(roomId, device, previous).then(
        (track) => {
          // Assigning also registered the device; undo that if the visitor left meanwhile,
          // unless they are back in the room already (or StrictMode remounted the page).
          if (!active) {
            if (latestSession.get(roomId) === session) releaseLayer(roomId, device);
            return;
          }
          pending = false;
          layer = track;
          if (track) writeLastPlayed(roomId, track.id);
          setState((s) => ({ status: 'ready', layer: track, turn: s.status === 'ready' ? s.turn + 1 : 0 }));
        },
        (err) => {
          if (!active) return;
          if (err instanceof NotFoundError) return setState({ status: 'not-found' });
          const run = () => {
            retry = null;
            assign(previous);
          };
          retry = { timer: window.setTimeout(run, RETRY_MS), run };
        },
      );
    };

    const heartbeat = () => {
      // A pending request records the device itself, with the track it is about to play.
      if (!pending) sendHeartbeat(roomId, device, layer?.id ?? null).catch(() => {});
    };

    nextRef.current = () => {
      if (active && !pending) assign(layer?.id ?? null);
    };

    // Background tabs may throttle or freeze timers, and a frozen page can outlive the presence
    // timeout, so coming back to view re-registers the device and retries a failed request.
    const resume = () => {
      if (document.visibilityState !== 'visible') return;
      if (retry) {
        clearTimeout(retry.timer);
        retry.run();
      } else {
        heartbeat();
      }
    };
    const pageshow = (e: PageTransitionEvent) => e.persisted && resume(); // back from bfcache
    const pagehide = () => releaseLayer(roomId, device);

    assign(readLastPlayed(roomId));
    const interval = window.setInterval(heartbeat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', pageshow);
    window.addEventListener('pagehide', pagehide);

    return () => {
      active = false;
      clearInterval(interval);
      if (retry) clearTimeout(retry.timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', pageshow);
      window.removeEventListener('pagehide', pagehide);
      nextRef.current = () => {};
      releaseLayer(roomId, device);
      setState({ status: 'loading' });
    };
  }, [roomId]);

  const next = useCallback(() => nextRef.current(), []);
  return { state, next };
}
