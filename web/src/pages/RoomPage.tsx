import { useEffect, useRef, useState } from 'react';
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
  // `turn` counts the tracks started, so a one-track room can replay the same file.
  | { status: 'ready'; room: RoomDetails; track: RoomFile | null; turn: number };

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

// Entering a room plays a random track, and each time one ends the next random pick starts,
// for as long as the visitor stays. The server makes every pick, so the order can become
// room-level once playback is synchronized.
export function RoomPage({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  // The pick to play after the current track, requested as soon as that track starts so no
  // request sits between two tracks. Cleared when the track changes or the visitor leaves.
  const upNext = useRef<{ after: string; track: Promise<RoomFile | null> } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([getRoom(id), getNextTrack(id, readLastPlayed(id))])
      .then(([room, track]) => active && setState({ status: 'ready', room, track, turn: 0 }))
      .catch((err) => active && setState({ status: err instanceof NotFoundError ? 'not-found' : 'error' }));
    return () => {
      active = false;
    };
  }, [id]);

  const current = state.status === 'ready' ? state.track : null;
  const turn = state.status === 'ready' ? state.turn : 0;

  useEffect(() => {
    if (!current) return;
    const track = getNextTrack(id, current.id);
    track.catch(() => {}); // a failed prefetch is retried when the track ends
    const entry = { after: current.id, track };
    upNext.current = entry;
    return () => {
      if (upNext.current === entry) upNext.current = null;
    };
  }, [id, current, turn]);

  const playNext = () => {
    const entry = upNext.current;
    if (!entry) return;
    entry.track
      .catch(() => getNextTrack(id, entry.after))
      .then((track) => {
        // Dropped if the visitor left the room meanwhile.
        if (upNext.current !== entry) return;
        setState((s) => (s.status === 'ready' ? { ...s, track, turn: s.turn + 1 } : s));
      })
      .catch(() => upNext.current === entry && setState({ status: 'error' }));
  };

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
              turn={state.turn}
              onPlay={(trackId) => writeLastPlayed(id, trackId)}
              onEnded={playNext}
            />
          ) : (
            <p className="status">This room has no tracks yet.</p>
          )}
        </>
      )}
    </main>
  );
}
