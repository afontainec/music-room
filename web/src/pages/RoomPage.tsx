import { useEffect, useState } from 'react';
import { getRoom, NotFoundError, type RoomDetails } from '../api/rooms';
import { Link } from '../router';

type State =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; room: RoomDetails };

// Placeholder room page: playback comes with the Random playback milestone.
export function RoomPage({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    getRoom(id)
      .then((room) => active && setState({ status: 'ready', room }))
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
        </>
      )}
    </main>
  );
}
