import type { ComponentPropsWithoutRef, CSSProperties, ReactNode, Ref } from 'react';
import { cx } from '../internal/cx';
import { Skeleton } from '../states/Skeleton';
import {
  clampToRange,
  defaultFormat,
  fractionOf,
  type MeterTone,
  type MeterZoneLike,
  normalizeRange,
  readingText,
  TONE_COLOR,
  zoneAt,
  zoneBands,
} from './meter';
import './Meter.css';

export type { MeterTone } from './meter';

export interface MeterZone extends MeterZoneLike {
  /** Start of the zone, in the same units as `value`. */
  from: number;
  /** End of the zone (exclusive, except the last zone), in the same units as `value`. */
  to: number;
  /** The zone colour: the accent, or one of the reserved status roles. */
  tone: MeterTone;
  /** Word for the zone ("Healthy", "Due"): shown under the gauge and read out with the value, so a zone is never colour alone. */
  label?: string;
}

/**
 * Props of a Meter: the reading, plus `className`, `style`, `ref` and the other `<div>` attributes.
 * The root reports `data-state` (`ready`, `unknown` or `loading`) and, while a reading falls in a
 * zone, `data-zone` with that zone's tone.
 */
export interface MeterProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** What is measured; the accessible name of the meter. */
  label: string;
  /** The reading in `min..max`; `null` is unknown (a dashed empty track and the word Unknown), never zero. */
  value: number | null;
  /** The low end of the range (default 0). */
  min?: number;
  /** The high end of the range (default 1, so a plain 0..1 fraction works). */
  max?: number;
  /** Track height: `md` 4 px (default) or `lg` 8 px. */
  size?: 'md' | 'lg';
  /** The fill colour: `accent` (default), or a reserved status role. Ignored when `zones` colour the track. */
  tone?: MeterTone;
  /** Bands of the range coloured by meaning (healthy, due, at risk): the track shows them and a notch marks the reading instead of a fill. */
  zones?: readonly MeterZone[];
  /** A fixed notch on the track in the same units as `value`: a target, a limit, the era boundary. */
  marker?: number;
  /** What the fixed notch is, as its hover title. */
  markerLabel?: string;
  /** Text under the left end of the track (a start height, `0`). */
  startLabel?: ReactNode;
  /** Text under the middle of the track. */
  midLabel?: ReactNode;
  /** Text under the right end of the track (an end height, a total). */
  endLabel?: ReactNode;
  /** Formats the reading for `aria-valuetext` and the shown value (default the share of the range, `61.9%`). */
  format?: (value: number, fraction: number) => string;
  /** Show the label above the track at the left. */
  showLabel?: boolean;
  /** Show the formatted reading above the track at the right (always shown when it is unknown). */
  showValue?: boolean;
  /** Show a skeleton instead of the meter. */
  loading?: boolean;
  /** Ref to the root element. */
  ref?: Ref<HTMLDivElement>;
}

const pct = (n: number): string => `${Math.round(n * 10000) / 100}%`;

/**
 * A single reading in a range: a thin track with a rounded fill (emission progress, locked
 * capacity), or, with `zones`, a gauge whose bands are named and whose notch marks the reading.
 * The track is a real `meter` with its value as text; unknown is a dashed track and the word
 * Unknown. The fill glides when the reading changes and does not animate under reduced motion.
 */
export function Meter({
  label,
  value,
  min,
  max,
  size = 'md',
  tone = 'accent',
  zones,
  marker,
  markerLabel,
  startLabel,
  midLabel,
  endLabel,
  format = defaultFormat,
  showLabel,
  showValue,
  loading,
  className,
  ref,
  ...rest
}: MeterProps) {
  const range = normalizeRange(min, max);
  const root = { ref, ...rest, className: cx('ui-meter', className), 'data-size': size };
  const hasEnds = startLabel !== undefined || midLabel !== undefined || endLabel !== undefined;

  if (loading) {
    return (
      <div {...root} data-state="loading" aria-busy="true">
        <Skeleton className="ui-meter__skeleton" radius="var(--r-pill)" />
        {hasEnds ? <span className="ui-meter__ends-space" aria-hidden="true" /> : null}
      </div>
    );
  }

  const fraction = fractionOf(value, range.min, range.max);
  const known = fraction !== null;
  const bands = zoneBands(zones, range.min, range.max);
  const zoned = bands.length > 0;
  const zone = zoneAt(bands, fraction);
  const markerAt = fractionOf(marker, range.min, range.max);
  const text = readingText(value, range.min, range.max, format, bands);
  const valueOnly = readingText(value, range.min, range.max, format);
  const now = clampToRange(value, range.min, range.max);
  const header = showLabel || showValue || !known;
  const style = { '--ui-meter-c': TONE_COLOR[tone] } as CSSProperties;

  return (
    <div
      {...root}
      data-state={known ? 'ready' : 'unknown'}
      data-tone={tone}
      data-zone={zone?.tone}
      data-zoned={zoned || undefined}
      data-marker={markerAt !== null || zoned || undefined}
    >
      {header ? (
        <div className="ui-meter__head">
          {showLabel ? <span className="ui-meter__label">{label}</span> : null}
          <span className="ui-meter__value" data-unknown={!known || undefined}>
            {showValue || !known ? valueOnly : null}
          </span>
        </div>
      ) : null}
      <div
        className="ui-meter__rail"
        {...(known
          ? {
              role: 'meter',
              'aria-label': label,
              'aria-valuemin': range.min,
              'aria-valuemax': range.max,
              'aria-valuenow': now ?? undefined,
              'aria-valuetext': text,
            }
          : { role: 'img', 'aria-label': `${label}: ${text}` })}
        style={style}
      >
        <div className="ui-meter__track">
          {zoned ? (
            bands.map((b) => (
              <span
                key={`${b.from}-${b.to}`}
                className="ui-meter__zone"
                data-tone={b.tone}
                data-current={b === zone || undefined}
                style={{ '--ui-meter-from': b.from, '--ui-meter-to': b.to } as CSSProperties}
              />
            ))
          ) : known && fraction > 0 ? (
            <span className="ui-meter__fill" style={{ '--ui-meter-frac': fraction } as CSSProperties} />
          ) : null}
        </div>
        {markerAt !== null ? (
          <span
            className="ui-meter__marker"
            title={markerLabel}
            style={{ '--ui-meter-at': markerAt } as CSSProperties}
          />
        ) : null}
        {zoned && known ? (
          <span
            className="ui-meter__marker"
            data-reading
            style={{ '--ui-meter-at': fraction } as CSSProperties}
          />
        ) : null}
      </div>
      {zoned && bands.some((b) => b.label) ? (
        <div className="ui-meter__zones" aria-hidden="true">
          {bands.map((b) =>
            b.label ? (
              <span
                key={`${b.from}-${b.to}`}
                className="ui-meter__zone-label"
                data-current={b === zone || undefined}
                style={{ left: pct(b.from), maxWidth: pct(b.to - b.from) }}
              >
                {b.label}
              </span>
            ) : null,
          )}
        </div>
      ) : null}
      {hasEnds ? (
        <div className="ui-meter__ends">
          <span className="ui-meter__end" data-at="start">
            {startLabel}
          </span>
          <span className="ui-meter__end" data-at="mid">
            {midLabel}
          </span>
          <span className="ui-meter__end" data-at="end">
            {endLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}
