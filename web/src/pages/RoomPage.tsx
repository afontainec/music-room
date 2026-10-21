import { useEffect, useState } from 'react';
import { getRoom, NotFoundError, type RoomDetails } from '../api/rooms';
import { AudioPlayer } from '../components/AudioPlayer';
import { RoomRings } from '../components/RoomRings';
import { useOptionalStaffSession } from '../hooks/useOptionalStaffSession';
import { useSoundscapeLayer } from '../hooks/useSoundscapeLayer';
import { Link } from '../router';

type RoomState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; room: RoomDetails };

// An open room page re-reads its room this often and on returning to view, so a staff edit (its
// name, colour or tracks) shows up without a reload.
const ROOM_REFRESH_MS = 30_000;

// Entering a room gives this device one layer of the soundscape, chosen by the server so the
// devices in the room play different tracks. When it ends the device gets its next layer, for as
// long as the visitor stays; the visitor sees the layer's name but does not choose it. The page
// links to no other room for visitors: they stay in the room their link opened. Staff with a valid
// session get a link back to the room list; leaving unmounts the player, which stops the audio.
// The rings in the centre take the room's colour.
export function RoomPage({ id }: { id: string }) {
  const [room, setRoom] = useState<RoomState>({ status: 'loading' });
  const { state: layer, next } = useSoundscapeLayer(id);
  const staff = useOptionalStaffSession();

  useEffect(() => {
    let active = true;
    let loaded = false;
    const load = () =>
      getRoom(id)
        .then((room) => {
          if (!active) return;
          loaded = true;
          setRoom({ status: 'ready', room });
        })
        .catch((err) => {
          if (!active) return;
          if (err instanceof NotFoundError) setRoom({ status: 'not-found' });
          // A failed refresh keeps the room on screen; only a failed first load shows the error.
          else if (!loaded) setRoom({ status: 'error' });
        });
    const onVisible = () => document.visibilityState === 'visible' && load();

    setRoom({ status: 'loading' });
    load();
    const timer = setInterval(load, ROOM_REFRESH_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [id]);

  const notFound = room.status === 'not-found' || layer.status === 'not-found';

  return (
    <main className="page">
      {staff && (
        <Link to="/" className="back-link">
          ← All rooms
        </Link>
      )}
      {notFound ? (
        <h1>Room not found</h1>
      ) : room.status === 'error' ? (
        <p className="status" role="alert">
          Could not load this room. Please try again later.
        </p>
      ) : room.status === 'loading' ? (
        <p className="status">Loading room…</p>
      ) : (
        <>
          <h1>{room.room.name}</h1>
          <p className="status">
            {room.room.files.length === 1 ? '1 track' : `${room.room.files.length} tracks`}
          </p>
          <RoomRings colour={room.room.colour} />
          {layer.status === 'loading' ? (
            <p className="status">Finding your layer…</p>
          ) : layer.status === 'ready' && layer.layer ? (
            <AudioPlayer
              src={layer.layer.url}
              title={layer.layer.name}
              trackId={layer.layer.id}
              turn={layer.turn}
              album={room.room.name}
              onEnded={next}
            />
          ) : (
            <p className="status">This room has no tracks yet.</p>
          )}
        </>
      )}
    </main>
  );
}
