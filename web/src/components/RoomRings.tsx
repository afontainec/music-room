import { useId, type CSSProperties } from 'react';

// The room page's centre visual from docs/design/visual-style.md ("Mono"): four concentric rings
// in a 280px box. The three outer rings use the --ring tokens; the inner ring, the centre dot and
// the radial glow behind them use the room's colour, through --room-colour (styles.css).
export function RoomRings({ colour }: { colour: string }) {
  // Gradient ids are document-wide, so each instance gets its own.
  const glow = `room-glow-${useId()}`;
  return (
    <div className="room-visual" style={{ '--room-colour': colour } as CSSProperties}>
      <svg viewBox="0 0 280 280" fill="none" aria-hidden="true">
        <defs>
          <radialGradient id={glow} className="room-glow">
            <stop offset="0%" stopOpacity="0.35" />
            <stop offset="100%" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className="room-ring-glow" cx="140" cy="140" r="90" fill={`url(#${glow})`} />
        <circle className="room-ring room-ring-1" cx="140" cy="140" r="138" />
        <circle className="room-ring room-ring-2" cx="140" cy="140" r="110" />
        <circle className="room-ring room-ring-3" cx="140" cy="140" r="82" />
        <circle className="room-ring room-ring-inner" cx="140" cy="140" r="54" strokeWidth="1.5" />
        <circle className="room-ring-dot" cx="140" cy="140" r="5" />
      </svg>
    </div>
  );
}
