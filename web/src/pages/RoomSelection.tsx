import { useEffect, useState } from 'react';
import { listRooms, type Room } from '../api/rooms';
import { Link } from '../router';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rooms: Room[] };

// Rooms are fetched on every visit, so rooms added or removed since show up on reload.
// `notice` explains why the visitor landed here, e.g. a link to a room that no longer exists.
export function RoomSelection({ notice }: { notice?: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    listRooms()
      .then((rooms) => active && setState({ status: 'ready', rooms }))
      .catch(() => active && setState({ status: 'error' }));
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="page">
      <h1>Choose a room</h1>
      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      {state.status === 'loading' && <p className="status">Loading rooms…</p>}
      {state.status === 'error' && (
        <p className="status" role="alert">
          Could not load rooms. Please try again later.
        </p>
      )}
      {state.status === 'ready' && state.rooms.length === 0 && <p className="status">No rooms yet.</p>}
      {state.status === 'ready' && state.rooms.length > 0 && (
        <ul className="room-list" aria-label="Rooms">
          {state.rooms.map((room) => (
            <li key={room.id}>
              <Link to={`/rooms/${room.id}`} className="room-card">
                {room.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
