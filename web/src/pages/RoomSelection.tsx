import { useEffect, useState } from 'react';
import { listRooms, StaffOnlyError, type Room } from '../api/rooms';
import { Link } from '../router';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'staff-only' }
  | { status: 'ready'; rooms: Room[] };

/** How often the open list is fetched again, so rooms that staff rename or delete elsewhere
 * update here within this long. */
export const ROOM_LIST_POLL_MS = 5_000;

// The list is fetched on every visit and then polled while staff see it (and again on returning
// to the tab), so renamed and deleted rooms update without a reload. The list is staff only;
// visitors open their room from a direct link instead, and get no polling.
export function RoomSelection() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let loading = false;
    let staffOnly = false;
    const load = () => {
      if (loading || staffOnly) return;
      clearTimeout(timer);
      loading = true;
      listRooms().then(
        (rooms) => {
          loading = false;
          if (!active) return;
          setState({ status: 'ready', rooms });
          timer = window.setTimeout(load, ROOM_LIST_POLL_MS);
        },
        (err) => {
          loading = false;
          if (!active) return;
          if (err instanceof StaffOnlyError) {
            staffOnly = true;
            return setState({ status: 'staff-only' });
          }
          // A failed poll keeps the list shown and tries again; only a failed first load shows the error.
          setState((s) => (s.status === 'ready' ? s : { status: 'error' }));
          timer = window.setTimeout(load, ROOM_LIST_POLL_MS);
        },
      );
    };
    const resume = () => document.visibilityState === 'visible' && load();
    load();
    document.addEventListener('visibilitychange', resume);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);

  // Until the server answers it is unknown whether this is staff, so nothing room-related shows.
  if (state.status === 'loading') {
    return (
      <main className="page">
        <p className="status">Loading…</p>
      </main>
    );
  }

  // Visitors get a message in place of the list; nothing about the rooms reaches their page.
  if (state.status === 'staff-only') {
    return (
      <main className="page">
        <h1>Ask for a room link</h1>
        <p className="status">
          Each room has its own link. Ask the staff here for the link to your room and open it on this device.
        </p>
        <p className="status">
          Staff? <Link to="/admin/login">Log in</Link> to see every room.
        </p>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>Choose a room</h1>
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
