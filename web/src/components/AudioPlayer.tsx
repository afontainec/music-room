import { useEffect, useRef, useState } from 'react';

type Status = 'starting' | 'playing' | 'paused' | 'error';

interface Props {
  src: string;
  title: string;
  trackId: string;
  onPlay?: (trackId: string) => void;
}

// Tries to autoplay; browsers that block it (Safari and iOS especially) leave the track paused
// behind a single Play button. play() runs directly in the click handler so the gesture counts.
export function AudioPlayer({ src, title, trackId, onPlay }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const [status, setStatus] = useState<Status>('starting');

  const play = () => {
    audio.current?.play().catch(() => setStatus((s) => (s === 'error' ? s : 'paused')));
  };

  useEffect(play, [src]);

  return (
    <section className="player" aria-label="Player">
      <audio
        ref={audio}
        src={src}
        preload="auto"
        data-track-id={trackId}
        onPlaying={() => setStatus('playing')}
        onPlay={() => onPlay?.(trackId)}
        onPause={() => setStatus('paused')}
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
