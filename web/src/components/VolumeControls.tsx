import { useState } from 'react';

export interface VolumeSettings {
  /** The visitor's level, 0 to 1; the fade-in of each layer rises to it. */
  volume: number;
  muted: boolean;
}

// Kept in memory only: the settings follow the visitor from layer to layer and room to room for
// as long as the page stays loaded, and a reload or a new visit starts again at full volume.
let remembered: VolumeSettings = { volume: 1, muted: false };

/** The visitor's volume and mute, shared by every room page of this page load. */
export function useVolumeSettings() {
  const [settings, setSettings] = useState(remembered);
  const update = (next: VolumeSettings) => {
    remembered = next;
    setSettings(next);
  };
  return [settings, update] as const;
}

interface Props {
  settings: VolumeSettings;
  onChange: (settings: VolumeSettings) => void;
}

// The round mute button and the volume slider at the bottom of the room page, as in
// docs/design/mockups/room.html. Both are native controls, so the button takes Enter and Space and
// the slider the arrow, Page and Home/End keys. Moving the slider while muted unmutes.
export function VolumeControls({ settings, onChange }: Props) {
  const { volume, muted } = settings;
  const percent = Math.round(volume * 100);

  return (
    <div className="volume-controls">
      <button
        type="button"
        className="icon-button"
        aria-label="Mute"
        aria-pressed={muted}
        onClick={() => onChange({ volume, muted: !muted })}
      >
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
          <path d="M11 5 6 9H2v6h4l5 4V5z" />
          {muted ? <path d="m16 9 6 6M22 9l-6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
        </svg>
      </button>
      <input
        className="volume"
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        aria-label="Volume"
        aria-valuetext={muted ? `${percent}%, muted` : `${percent}%`}
        data-muted={muted || undefined}
        onChange={(e) => onChange({ volume: Number(e.currentTarget.value) / 100, muted: false })}
      />
    </div>
  );
}
