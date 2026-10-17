import { useEffect, useState } from 'react';
import { clearToken } from '../api/auth';
import { listRooms, type Room } from '../api/rooms';
import { useStaffSession } from '../hooks/useStaffSession';
import { Link, navigate } from '../router';

type RoomsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rooms: Room[] };

export function StaffArea() {
  const session = useStaffSession();
  const [rooms, setRooms] = useState<RoomsState>({ status: 'loading' });

  useEffect(() => {
    if (session.status !== 'ready') return;
    let active = true;
    listRooms()
      .then((list) => active && setRooms({ status: 'ready', rooms: list }))
      .catch(() => active && setRooms({ status: 'error' }));
    return () => {
      active = false;
    };
  }, [session.status]);

  const logOut = () => {
    clearToken();
    navigate('/admin/login');
  };

  return (
    <main className="page">
      <h1>Staff area</h1>
      {session.status === 'loading' && <p className="status">Checking your session…</p>}
      {session.status === 'error' && (
        <p className="status" role="alert">
          Could not check your session. Please try again later.
        </p>
      )}
      {session.status === 'ready' && (
        <>
          <p className="status">Signed in as {session.session.username}.</p>
          <h2>Rooms</h2>
          {rooms.status === 'loading' && <p className="status">Loading rooms…</p>}
          {rooms.status === 'error' && (
            <p className="status" role="alert">
              Could not load rooms. Please try again later.
            </p>
          )}
          {rooms.status === 'ready' && rooms.rooms.length === 0 && <p className="status">No rooms yet.</p>}
          {rooms.status === 'ready' && rooms.rooms.length > 0 && (
            <ul className="room-list" aria-label="Rooms">
              {rooms.rooms.map((room) => (
                <li key={room.id}>
                  <Link to={`/admin/rooms/${room.id}`} className="room-card">
                    {room.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="secondary-button log-out" onClick={logOut}>
            Log out
          </button>
        </>
      )}
    </main>
  );
}
