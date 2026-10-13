import { useEffect, useRef, useState } from 'react';

type Status = 'starting' | 'playing' | 'paused' | 'error';

interface Props {
  src: string;
  title: string;
  trackId: string;
  /** Changes for every track started, so a one-track room replays the same src. */
  turn: number;
  onPlay?: (trackId: string) => void;
  onEnded?: () => void;
}

// Tries to autoplay; browsers that block it (Safari and iOS especially) leave the track paused
// behind a single Play button. play() runs directly in the click handler so the gesture counts.
// Following tracks reuse the same audio element, which the browser lets play once one has.
export function AudioPlayer({ src, title, trackId, turn, onPlay, onEnded }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState<Status>('starting');

  const play = () => {
    audio.current?.play().catch(() => setStatus((s) => (s === 'error' ? s : 'paused')));
  };

  useEffect(play, [src, turn]);

  // Leaving the room stops playback, even where a detached element would keep playing.
  useEffect(() => {
    const el = audio.current;
    return () => el?.pause();
  }, []);

  return (
    <section className="player" aria-label="Player">
      <audio
        ref={audio}
        src={src}
        preload="auto"
        data-track-id={trackId}
        onPlaying={() => setStatus('playing')}
        onPlay={() => onPlay?.(trackId)}
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
          Play
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
