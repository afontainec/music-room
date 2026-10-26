import { useEffect, useState, type ReactNode } from 'react';
import { getRoom, NotFoundError, type RoomDetails } from '../api/rooms';
import { AudioPlayer } from '../components/AudioPlayer';
import { RoomRings } from '../components/RoomRings';
import { useVolumeSettings, VolumeControls } from '../components/VolumeControls';
import { useOptionalStaffSession } from '../hooks/useOptionalStaffSession';
import { useSoundscapeLayer } from '../hooks/useSoundscapeLayer';
import { Link } from '../router';
import './RoomPage.css';

type RoomState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error' }
  | { status: 'ready'; room: RoomDetails };

// The layer's place on the page, under the "Your layer" label, before the player has a name to show.
function LayerStatus({ children }: { children: ReactNode }) {
  return (
    <div className="room-layer">
      <span className="label">Your layer</span>
      <p className="body-text">{children}</p>
    </div>
  );
}

// Entering a room gives this device one layer of the soundscape, chosen by the server so the
// devices in the room play different tracks. When it ends the device gets its next layer, for as
// long as the visitor stays; the visitor sees the layer's name but does not choose it. The page
// links to no other room for visitors: they stay in the room their link opened. Staff with a valid
// session get a link back to the room list; leaving unmounts the player, which stops the audio.
// The look is the "Mono" direction of docs/design/visual-style.md: the room's name as a label, the
// rings in the room's colour, the layer's name in large light type, and at the bottom the
// visitor's mute button and volume slider, which change only this device's sound.
export function RoomPage({ id }: { id: string }) {
  const [room, setRoom] = useState<RoomState>({ status: 'loading' });
  const { state: layer, next, played } = useSoundscapeLayer(id);
  const staff = useOptionalStaffSession();
  const [sound, setSound] = useVolumeSettings();
  // How loud this device's layer is right now (0 to 1), for the rings to react to.
  const [audioLevel, setAudioLevel] = useState(0);

  // The room is read once on entry; a staff edit (name, colour, tracks) shows after a reload.
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

  return (
    <main className="room">
      <div className="room-top">
        {staff && (
          <Link to="/" className="room-back">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
            Rooms
          </Link>
        )}
        {room.status === 'ready' && !notFound && <h1 className="label room-name">{room.room.name}</h1>}
      </div>
      {notFound ? (
        <div className="room-message">
          <h1 className="title">Room not found</h1>
        </div>
      ) : room.status === 'error' ? (
        <div className="room-message">
          <p className="body-text" role="alert">
            Could not load this room. Please try again later.
          </p>
        </div>
      ) : room.status === 'loading' ? (
        <div className="room-message">
          <p className="body-text">Loading room…</p>
        </div>
      ) : (
        <>
          <RoomRings colour={room.room.colour} level={layer.status === 'ready' && layer.layer ? audioLevel : 0} />
          {layer.status === 'loading' ? (
            <LayerStatus>Finding your layer…</LayerStatus>
          ) : layer.status === 'ready' && layer.layer ? (
            <>
              <AudioPlayer
                src={layer.layer.url}
                title={layer.layer.name}
                trackId={layer.layer.id}
                turn={layer.turn}
                album={room.room.name}
                onEnded={next}
                onStarted={() => played(layer.layer!.id)}
                volume={sound.volume}
                muted={sound.muted}
                onLevel={setAudioLevel}
              />
              <VolumeControls settings={sound} onChange={setSound} />
            </>
          ) : (
            <LayerStatus>This room has no tracks yet.</LayerStatus>
          )}
        </>
      )}
    </main>
  );
}
