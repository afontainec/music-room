import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoom, SessionExpiredError } from '../api/admin';
import { clearToken } from '../api/auth';
import { listRooms, type Room } from '../api/rooms';
import { useStaffSession } from '../hooks/useStaffSession';
import { Link, navigate } from '../router';

type RoomsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rooms: Room[] };

// The staff area: every room, linking to its staff page, and a form to create one. The list is
// fetched again after a room is created, so it always shows what visitors get.
export function StaffArea() {
  const session = useStaffSession();
  const [rooms, setRooms] = useState<RoomsState>({ status: 'loading' });
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Only the latest request may update the list, so a slow earlier one cannot overwrite it.
  const latest = useRef(0);
  const ready = session.status === 'ready';

  const loadRooms = useCallback(() => {
    const request = ++latest.current;
    listRooms()
      .then((list) => request === latest.current && setRooms({ status: 'ready', rooms: list }))
      .catch(() => request === latest.current && setRooms({ status: 'error' }));
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadRooms();
    return () => {
      latest.current++;
    };
  }, [ready, loadRooms]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return setCreateError('Enter a name for the room.');
    setCreating(true);
    setCreateError(null);
    try {
      await createRoom(newName);
      setNewName('');
    } catch (err) {
      if (err instanceof SessionExpiredError) return navigate('/admin/login');
      setCreateError(err instanceof Error && err.message ? err.message : 'Could not create the room. Please try again.');
    } finally {
      setCreating(false);
      loadRooms();
    }
  };

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
          <form className="inline-form" onSubmit={onCreate}>
            <label>
              New room name
              <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} />
            </label>
            <button type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create room'}
            </button>
          </form>
          {createError && (
            <p className="form-error" role="alert">
              {createError}
            </p>
          )}
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
