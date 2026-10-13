import { useEffect, useState } from 'react';
import {
  getNextTrack,
  getRoom,
  NotFoundError,
  trackTitle,
  trackUrl,
  type RoomDetails,
  type RoomFile,
} from '../api/rooms';
import { AudioPlayer } from '../components/AudioPlayer';
import { Link } from '../router';

type State =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; room: RoomDetails; track: RoomFile | null };

// The last track played per room, kept for the tab's session so re-entering a room
// does not start with the same track again.
const lastPlayedKey = (roomId: string) => `music-room:last-played:${roomId}`;

function readLastPlayed(roomId: string): string | null {
  try {
    return sessionStorage.getItem(lastPlayedKey(roomId));
  } catch {
    return null; // storage disabled, e.g. some private browsing modes
  }
}

function writeLastPlayed(roomId: string, trackId: string) {
  try {
    sessionStorage.setItem(lastPlayedKey(roomId), trackId);
  } catch {
    // Without storage the next visit may repeat the track; playback still works.
  }
}

// Entering a room plays one random track; the continuous loop comes with the next milestone.
export function RoomPage({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    Promise.all([getRoom(id), getNextTrack(id, readLastPlayed(id))])
      .then(([room, track]) => active && setState({ status: 'ready', room, track }))
      .catch((err) => active && setState({ status: err instanceof NotFoundError ? 'not-found' : 'error' }));
    return () => {
      active = false;
    };
  }, [id]);

  return (
    <main className="page">
      <Link to="/" className="back-link">
        ← All rooms
      </Link>
      {state.status === 'loading' && <p className="status">Loading room…</p>}
      {state.status === 'not-found' && <h1>Room not found</h1>}
      {state.status === 'error' && (
        <p className="status" role="alert">
          Could not load this room. Please try again later.
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <h1>{state.room.name}</h1>
          <p className="status">
            {state.room.files.length === 1 ? '1 track' : `${state.room.files.length} tracks`}
          </p>
          {state.track ? (
            <AudioPlayer
              src={trackUrl(state.track)}
              title={trackTitle(state.track)}
              trackId={state.track.id}
              onPlay={(trackId) => writeLastPlayed(id, trackId)}
            />
          ) : (
            <p className="status">This room has no tracks yet.</p>
          )}
        </>
      )}
    </main>
  );
}
