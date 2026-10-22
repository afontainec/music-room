import { ROOM_PALETTE } from '../palette';

// The room palette as a group of swatches, one native radio each (named after the colour, so the
// swatch is never the only cue), so arrow keys move between them. Only palette colours are offered.
// `disabled` disables the whole group, e.g. while a request is in flight.
export function ColourPicker({
  legend,
  name,
  value,
  onChange,
  disabled = false,
}: {
  legend: string;
  name: string;
  value: string | null;
  onChange: (colour: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="colour-picker" disabled={disabled}>
      <legend>{legend}</legend>
      {ROOM_PALETTE.map((colour) => (
        <label key={colour.value} className="colour-swatch" title={colour.name}>
          <input
            type="radio"
            name={name}
            value={colour.value}
            checked={value === colour.value}
            onChange={() => onChange(colour.value)}
          />
          <span className="colour-dot" style={{ background: colour.value }} aria-hidden="true" />
          <span className="colour-name">{colour.name}</span>
        </label>
      ))}
    </fieldset>
  );
}
