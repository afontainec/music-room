import { useEffect, useRef, useState } from 'react';

type Status = 'starting' | 'playing' | 'paused' | 'error';

/** Each layer fades in over this long from the moment it starts playing. */
export const FADE_IN_MS = 3_000;
const FADE_STEP_MS = 50;

interface Props {
  src: string;
  title: string;
  trackId: string;
  /** Changes for every track started, so a one-track room replays the same src. */
  turn: number;
  /** Shown with the title on the lock screen and in the system media controls. */
  album?: string;
  onEnded?: () => void;
}

// Tries to autoplay; browsers that block it (Safari and iOS especially) leave the track paused
// behind a single "Tap to listen" button, which hides once the track plays. play() runs directly
// in the click handler so the gesture counts; a native button also takes Enter and Space.
// Following tracks reuse the same audio element, which the browser lets play once one has, and
// which keeps playing with the screen locked or the tab hidden where the browser allows.
export function AudioPlayer({ src, title, trackId, turn, album, onEnded }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState<Status>('starting');
  // False only after the visitor paused from the lock screen or media keys, so returning to
  // the page resumes an interrupted track but not one the visitor stopped.
  const wantsPlay = useRef(true);
  const fade = useRef<{ turn: number; timer?: number }>({ turn: -1 });

  // A rejected play() (autoplay blocked, NotAllowedError) leaves the track paused behind the
  // "Tap to listen" button. An AbortError only means a new src or a pause() interrupted this
  // call; the new src gets its own play() and a pause reports itself, so showing the button
  // then would be a false positive.
  const play = () => {
    wantsPlay.current = true;
    audio.current?.play().catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setStatus((s) => (s === 'error' ? s : 'paused'));
    });
  };

  useEffect(() => {
    // Silent until it starts playing, then the fade brings it in.
    clearInterval(fade.current.timer);
    if (audio.current) audio.current.volume = 0;
    play();
  }, [src, turn]);

  // Volume follows the time since the layer started rather than counting steps, so throttled
  // timers in a background tab still finish the fade on time. iOS ignores volume (fixed at 1).
  const fadeIn = () => {
    const el = audio.current;
    if (!el || fade.current.turn === turn) return;
    clearInterval(fade.current.timer);
    const start = performance.now();
    const step = () => {
      el.volume = Math.min(1, (performance.now() - start) / FADE_IN_MS);
      if (el.volume >= 1) clearInterval(fade.current.timer);
    };
    fade.current = { turn, timer: window.setInterval(step, FADE_STEP_MS) };
    step();
  };

  // Leaving the room stops playback, even where a detached element would keep playing.
  useEffect(() => {
    const el = audio.current;
    return () => {
      clearInterval(fade.current.timer);
      el?.pause();
    };
  }, []);

  // A call, another app or the OS can pause the track while the page is hidden; resume it once
  // the page is back in view. Asking for the next layer after one ended meanwhile is the hook's job.
  useEffect(() => {
    const resume = () => {
      const el = audio.current;
      if (document.visibilityState !== 'visible' || !el || !wantsPlay.current) return;
      if (el.paused && !el.ended) play();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
    };
  }, []);

  // Lock screen and notification controls: the layer's name, and play/pause that this page
  // can tell apart from interruptions.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title, album });
  }, [title, album]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    session.setActionHandler('play', play);
    session.setActionHandler('pause', () => {
      wantsPlay.current = false;
      audio.current?.pause();
    });
    return () => {
      session.setActionHandler('play', null);
      session.setActionHandler('pause', null);
      session.metadata = null;
    };
  }, []);

  return (
    <section className="player" aria-label="Player">
      <audio
        ref={audio}
        src={src}
        preload="auto"
        data-track-id={trackId}
        onPlaying={() => {
          setStatus('playing');
          fadeIn();
        }}
        // A track reaching its end also pauses; the next one starts without asking the user.
        onPause={(e) => !e.currentTarget.ended && setStatus('paused')}
        onEnded={onEnded}
        // Only a track that never loaded is unplayable; Firefox also reports audio output
        // errors (e.g. no sound device) here while the track keeps playing.
        onError={(e) => e.currentTarget.readyState === HTMLMediaElement.HAVE_NOTHING && setStatus('error')}
      />
      <p className="now-playing">
        {status === 'playing' ? 'Now playing' : 'Up next'}: <strong>{title}</strong>
      </p>
      {status === 'paused' && (
        <button type="button" className="play-button" onClick={play}>
          Tap to listen
        </button>
      )}
      {status === 'error' && (
        <p className="status" role="alert">
          This track could not be played.
        </p>
      )}
    </section>
  );
}
