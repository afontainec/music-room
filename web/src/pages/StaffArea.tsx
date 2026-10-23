import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createRoom, listAllRooms, SessionExpiredError } from '../api/admin';
import { clearToken } from '../api/auth';
import type { RoomSummary } from '../api/rooms';
import { ColourPicker } from '../components/ColourPicker';
import { useStaffSession } from '../hooks/useStaffSession';
import { colourName, defaultColour } from '../palette';
import { Link, navigate } from '../router';
import './Staff.css';

type RoomsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rooms: RoomSummary[] };

// The staff area: every room, linking to its staff page, and a form to create one. The list is
// fetched again after a room is created, so it always shows what visitors get. The form's colour
// starts on the one the server would default to, computed from that list, until staff pick another.
export function StaffArea() {
  const session = useStaffSession();
  const [rooms, setRooms] = useState<RoomsState>({ status: 'loading' });
  const [newName, setNewName] = useState('');
  // The colour staff picked for the new room; null follows the default.
  const [pickedColour, setPickedColour] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Only the latest request may update the list, so a slow earlier one cannot overwrite it.
  const latest = useRef(0);
  const ready = session.status === 'ready';

  const loadRooms = useCallback(() => {
    const request = ++latest.current;
    listAllRooms()
      .then((list) => request === latest.current && setRooms({ status: 'ready', rooms: list }))
      .catch((err) => {
        if (request !== latest.current) return;
        if (err instanceof SessionExpiredError) return navigate('/admin/login');
        setRooms({ status: 'error' });
      });
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadRooms();
    return () => {
      latest.current++;
    };
  }, [ready, loadRooms]);

  // Without the list (still loading or failed) there is no default to show: the server assigns it.
  const colour = pickedColour ?? (rooms.status === 'ready' ? defaultColour(rooms.rooms.map((r) => r.colour)) : null);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (creating) return;
    if (!newName.trim()) return setCreateError('Enter a name for the room.');
    setCreating(true);
    setCreateError(null);
    try {
      await createRoom(newName, colour ?? undefined);
      setNewName('');
      setPickedColour(null);
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
    <main className="staff">
      <div className="staff-brand">
        <span className="label">Music Rooms</span>
        {session.status === 'ready' && (
          <div className="staff-nav">
            <Link to="/admin/analytics">Analytics</Link>
            <button type="button" className="staff-button staff-button-secondary" onClick={logOut}>
              Log out
            </button>
          </div>
        )}
      </div>
      <div className="staff-intro">
        <h1 className="title">Staff area</h1>
        {session.status === 'loading' && <p className="body-text">Checking your session…</p>}
        {session.status === 'error' && (
          <p className="body-text" role="alert">
            Could not check your session. Please try again later.
          </p>
        )}
        {session.status === 'ready' && <p className="body-text">Signed in as {session.session.username}.</p>}
      </div>
      {session.status === 'ready' && (
        <>
          <section className="staff-section" aria-labelledby="staff-new-room-title">
            <h2 className="staff-section-title" id="staff-new-room-title">
              New room
            </h2>
            <form className="staff-card" onSubmit={onCreate}>
              <ColourPicker
                legend="New room colour"
                name="new-room-colour"
                value={colour}
                onChange={setPickedColour}
                disabled={creating}
              />
              <div className="staff-row">
                <label className="staff-field">
                  New room name
                  <input
                    className="staff-input"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    maxLength={100}
                  />
                </label>
                <button type="submit" className="staff-button" disabled={creating}>
                  {creating ? 'Creating…' : 'Create room'}
                </button>
              </div>
              {createError && (
                <p className="staff-error" role="alert">
                  {createError}
                </p>
              )}
            </form>
          </section>
          <section className="staff-section" aria-labelledby="staff-rooms-title">
            <h2 className="staff-section-title" id="staff-rooms-title">
              Rooms
            </h2>
            {rooms.status === 'loading' && <p className="body-text">Loading rooms…</p>}
            {rooms.status === 'error' && (
              <p className="body-text" role="alert">
                Could not load rooms. Please try again later.
              </p>
            )}
            {rooms.status === 'ready' && rooms.rooms.length === 0 && <p className="body-text">No rooms yet.</p>}
            {rooms.status === 'ready' && rooms.rooms.length > 0 && (
              <ul className="staff-rooms" aria-label="Rooms">
                {rooms.rooms.map((room) => (
                  <li key={room.id}>
                    {/* Named by the room alone; its colour's name is the description. */}
                    <Link
                      to={`/admin/rooms/${room.id}`}
                      className="staff-room"
                      style={{ '--room-colour': room.colour } as CSSProperties}
                      aria-labelledby={`staff-room-${room.id}-name`}
                      aria-describedby={`staff-room-${room.id}-colour`}
                    >
                      <span className="staff-room-dot" aria-hidden="true" />
                      <span className="staff-room-name" id={`staff-room-${room.id}-name`}>
                        {room.name}
                      </span>
                      <span className="staff-room-colour" id={`staff-room-${room.id}-colour`}>
                        {colourName(room.colour)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
