import { useEffect, useState } from 'react';
import { getRoom, NotFoundError, type RoomDetails } from '../api/rooms';
import { AudioPlayer } from '../components/AudioPlayer';
import { useOptionalStaffSession } from '../hooks/useOptionalStaffSession';
import { useSoundscapeLayer } from '../hooks/useSoundscapeLayer';
import { Link, navigate } from '../router';

type RoomState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; room: RoomDetails };

// Entering a room gives this device one layer of the soundscape, chosen by the server so the
// devices in the room play different tracks. When it ends the device gets its next layer, for as
// long as the visitor stays; the visitor sees the layer's name but does not choose it. The page
// links to no other room for visitors: they stay in the room their link opened. Staff with a valid
// session get a link back to the room list; leaving unmounts the player, which stops the audio.
export function RoomPage({ id }: { id: string }) {
  const [room, setRoom] = useState<RoomState>({ status: 'loading' });
  const { state: layer, roomName, next } = useSoundscapeLayer(id);
  const staff = useOptionalStaffSession();

  useEffect(() => {
    let active = true;
    setRoom({ status: 'loading' });
    getRoom(id)
      .then((room) => active && setRoom({ status: 'ready', room }))
      .catch((err) => active && setRoom({ status: err instanceof NotFoundError ? 'not-found' : 'error' }));
    return () => {
      active = false;
    };
  }, [id]);

  const notFound = room.status === 'not-found' || layer.status === 'not-found';
  // A room that loaded and then went missing was deleted by staff while the visitor was in it.
  // Unmounting the player stops the audio; the visitor gets a way back instead of silence.
  const deleted = notFound && room.status === 'ready';
  // A rename only changes the text: the player keeps its audio element and the layer plays on.
  const name = room.status === 'ready' ? (roomName ?? room.room.name) : '';

  if (deleted) {
    return (
      <main className="page">
        <h1>This room has closed</h1>
        <p className="status" role="status">
          Staff have removed this room, so its soundscape has stopped. Thanks for listening.
        </p>
        <button type="button" className="play-button" onClick={() => navigate('/')}>
          Back to room selection
        </button>
      </main>
    );
  }

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
          <h1>{name}</h1>
          <p className="status">
            {room.room.files.length === 1 ? '1 track' : `${room.room.files.length} tracks`}
          </p>
          {layer.status === 'loading' ? (
            <p className="status">Finding your layer…</p>
          ) : layer.status === 'ready' && layer.layer ? (
            <AudioPlayer
              src={layer.layer.url}
              title={layer.layer.name}
              trackId={layer.layer.id}
              turn={layer.turn}
              album={name}
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
