import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { listRooms, type RoomSummary } from '../api/rooms';
import { Link } from '../router';
import './RoomSelection.css';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; rooms: RoomSummary[] };

const layerCount = (n: number) => (n === 0 ? 'No layers yet' : n === 1 ? '1 layer' : `${n} layers`);

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="selection">
      <div className="selection-brand">
        <span className="label">Music Rooms</span>
        <span className="selection-brand-dot" aria-hidden="true" />
      </div>
      {children}
    </main>
  );
}

// Rooms are fetched on every visit, so rooms added or removed since show up on reload. The list
// is public, so visitors and staff see the same rooms.
export function RoomSelection() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    listRooms()
      .then((rooms) => active && setState({ status: 'ready', rooms }))
      .catch(() => active && setState({ status: 'error' }));
    return () => {
      active = false;
    };
  }, [attempt]);

  if (state.status === 'loading') {
    return (
      <Page>
        <p className="body-text" role="status">
          Loading…
        </p>
      </Page>
    );
  }

  return (
    <Page>
      <div className="selection-intro">
        <h1 className="title">Where are you?</h1>
        {state.status === 'error' && (
          <>
            <p className="body-text" role="alert">
              Could not load rooms. Please try again later.
            </p>
            <button type="button" className="selection-retry" onClick={retry}>
              Try again
            </button>
          </>
        )}
        {state.status === 'ready' && state.rooms.length === 0 && <p className="body-text">No rooms yet.</p>}
        {state.status === 'ready' && state.rooms.length > 0 && (
          <p className="body-text">Pick the room you are in. Your phone joins its soundscape.</p>
        )}
      </div>
      {state.status === 'ready' && state.rooms.length > 0 && (
        <ul className="room-grid" aria-label="Rooms">
          {state.rooms.map((room) => (
            <li key={room.id}>
              {/* Named by the room alone; the layer count is its description. */}
              <Link
                to={`/rooms/${room.id}`}
                className="room-tile"
                style={{ '--room-colour': room.colour } as CSSProperties}
                aria-labelledby={`room-${room.id}-name`}
                aria-describedby={`room-${room.id}-layers`}
              >
                <span className="room-tile-dot" aria-hidden="true" />
                <span className="room-tile-meta">
                  <span className="room-tile-name" id={`room-${room.id}-name`}>
                    {room.name}
                  </span>
                  <span className="room-tile-layers" id={`room-${room.id}-layers`}>
                    {layerCount(room.trackCount)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
