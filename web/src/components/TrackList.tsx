import type { Track } from '../api/admin';

export type TracksState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; tracks: Track[] };

interface Props {
  state: TracksState;
  onRetry: () => void;
  onRemove: (track: Track) => void;
  /** The track being removed, whose button is disabled meanwhile. */
  removingId: string | null;
}

// A room's tracks in the staff area, with loading, error and empty states.
export function TrackList({ state, onRetry, onRemove, removingId }: Props) {
  if (state.status === 'loading') return <p className="status">Loading tracks…</p>;
  if (state.status === 'error') {
    return (
      <div className="status" role="alert">
        <p>Could not load the tracks.</p>
        <button type="button" className="secondary-button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  if (state.tracks.length === 0) {
    return (
      <p className="status empty-state">
        No tracks yet. Upload an mp3 above to give this room its first layer.
      </p>
    );
  }
  return (
    <ul className="track-list" aria-label="Tracks">
      {state.tracks.map((track) => (
        <li key={track.id} className="track-item">
          <span className="track-name">{track.name}</span>
          <button
            type="button"
            className="secondary-button"
            aria-label={`Remove ${track.name}`}
            disabled={removingId === track.id}
            onClick={() => onRemove(track)}
          >
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}
