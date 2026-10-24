import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { getRoom, NotFoundError, type Room } from '../api/rooms';
import { useStaffSession } from '../hooks/useStaffSession';
import { Link } from '../router';

type RoomState = { status: 'loading' } | { status: 'not-found' } | { status: 'error' } | { status: 'ready'; room: Room };

/** The address visitors open a room at (the `/rooms/:id` route of App.tsx) on this server. */
export const publicRoomUrl = (id: string) => `${window.location.origin}/rooms/${encodeURIComponent(id)}`;

// A room's QR code for staff to show or print: scanning it opens the room for a visitor. The URL
// is shown as text below it for devices that cannot scan.
export function AdminRoomQrPage({ id }: { id: string }) {
  const session = useStaffSession();
  const [room, setRoom] = useState<RoomState>({ status: 'loading' });
  const [qrFailed, setQrFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ready = session.status === 'ready';
  const url = publicRoomUrl(id);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    getRoom(id)
      .then((r) => active && setRoom({ status: 'ready', room: r }))
      .catch((err) => active && setRoom({ status: err instanceof NotFoundError ? 'not-found' : 'error' }));
    return () => {
      active = false;
    };
  }, [id, ready]);

  const shown = room.status === 'ready';
  useEffect(() => {
    if (!shown || !canvas.current) return;
    // Dark modules on white with the standard 4-module quiet zone, whatever the page theme, so
    // phone cameras read it on screen and on paper.
    QRCode.toCanvas(canvas.current, url, { width: 280, margin: 4, color: { dark: '#000000', light: '#ffffff' } })
      .then(() => setQrFailed(false))
      .catch(() => setQrFailed(true));
  }, [shown, url]);

  return (
    <main className="page">
      <Link to={`/admin/rooms/${encodeURIComponent(id)}`} className="back-link">
        ← Back to room
      </Link>
      {session.status === 'loading' || (ready && room.status === 'loading') ? (
        <p className="status">Loading room…</p>
      ) : session.status === 'error' ? (
        <p className="status" role="alert">
          Could not check your session. Please try again later.
        </p>
      ) : room.status === 'not-found' ? (
        <h1>Room not found</h1>
      ) : room.status === 'error' ? (
        <p className="status" role="alert">
          Could not load this room. Please try again later.
        </p>
      ) : room.status === 'ready' ? (
        <section className="room-qr">
          <h1>{room.room.name}</h1>
          <p className="status">Scan to open this room.</p>
          <canvas ref={canvas} className="room-qr-code" role="img" aria-label={`QR code for ${url}`} />
          {qrFailed && (
            <p className="form-error" role="alert">
              Could not draw the QR code. Visitors can use the link below.
            </p>
          )}
          <p className="room-qr-url">
            <span className="label">Room link</span>
            <a href={url}>{url}</a>
          </p>
        </section>
      ) : null}
    </main>
  );
}
