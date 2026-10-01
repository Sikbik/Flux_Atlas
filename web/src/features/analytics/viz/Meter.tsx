import './viz.css';

export interface MeterProps {
  /** 0..1 */
  value: number;
  /** An optional marker position, 0..1 (a limit, a threshold). */
  marker?: number;
  label: string;
  /** Override the fill colours with a single token. */
  color?: string;
}

/** A thin progress track: a lighter step of the same ramp behind a Flux-blue fill. */
export function Meter({ value, marker, label, color }: MeterProps) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    // biome-ignore lint/a11y/useSemanticElements: a styled meter; the native element cannot carry the marker
    <div
      className="vz-meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      style={color ? { background: 'var(--ink-3)' } : undefined}
    >
      <i style={{ ['--w' as string]: v, ...(color ? { background: color } : {}) }} />
      {marker !== undefined ? <b style={{ left: `${Math.max(0, Math.min(1, marker)) * 100}%` }} /> : null}
    </div>
  );
}
