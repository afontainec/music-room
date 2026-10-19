import { useEffect, useState } from 'react';
import { listRooms, StaffOnlyError, type Room } from '../api/rooms';
import { Link } from '../router';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'staff-only' }
  | { status: 'ready'; rooms: Room[] };

// Rooms are fetched on every visit, so rooms added or removed since show up on reload. The list
// is staff only; visitors open their room from a direct link instead.
export function RoomSelection() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    listRooms()
      .then((rooms) => active && setState({ status: 'ready', rooms }))
      .catch((err) => active && setState({ status: err instanceof StaffOnlyError ? 'staff-only' : 'error' }));
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="page">
      <h1>Choose a room</h1>
      {state.status === 'loading' && <p className="status">Loading rooms…</p>}
      {state.status === 'error' && (
        <p className="status" role="alert">
          Could not load rooms. Please try again later.
        </p>
      )}
      {state.status === 'staff-only' && (
        <p className="status">
          Open your room from the link you were given. Staff can <Link to="/admin/login">log in</Link> to see every
          room.
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
