import type { ComponentPropsWithRef, CSSProperties } from 'react';
import { formatInt, UNKNOWN } from '../../lib/format';
import '../base.css';
import { cx } from '../internal/cx';
import './AnimatedNumber.css';
import { useMotionMode } from '../internal/useMotion';
import { type Cell as CellPlan, isDigit, ROLL_STAGGER_MS, type RollDirection, staticCells } from './odometer';
import { useOdometer } from './useOdometer';

/** Props of an AnimatedNumber: the options below plus every `<span>` attribute, including `ref`, `className` and `style`. */
export interface AnimatedNumberProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** The number to show. `null` or `undefined` renders Unknown, never a zero. */
  value: number | null | undefined;
  /** Formats the number for display (default `formatInt`: `6,724`). Changes are detected on this text. */
  format?: (n: number) => string;
  /** `display` (default) is Montserrat with tabular figures; `mono` is IBM Plex Mono. */
  font?: 'display' | 'mono';
  /** Tints the number by direction (`--div-pos` up, `--div-neg` down) for 600 ms, then fades. Defaults to the value of `roll`. */
  tint?: boolean;
  /** Rolls the changed digits (default true). Pass false for seconds-style counters: they swap instantly and do not tint. */
  roll?: boolean;
  /** Counts up from zero the first time a number is shown (a window opening, a hero figure). */
  countUpOnMount?: boolean;
  /** Most visual updates per second (default 1, for network counters). 0 shows every update. */
  maxHz?: number;
}

const delay = (rank: number): CSSProperties => ({ animationDelay: `${rank * ROLL_STAGGER_MS}ms` });

function Glyph({ cell, dir }: { cell: CellPlan; dir: RollDirection | null }) {
  if (!cell.digit) {
    return (
      <span
        className="ui-number__char"
        data-fresh={cell.changed && dir ? '' : undefined}
        style={dir && cell.changed ? delay(cell.rank) : undefined}
      >
        {cell.ch}
      </span>
    );
  }
  if (!cell.changed || dir === null) return <span className="ui-number__cell">{cell.ch}</span>;
  return (
    <span className="ui-number__cell" data-roll={dir}>
      <span className="ui-number__in" style={delay(cell.rank)}>
        {cell.ch}
      </span>
      {isDigit(cell.from) ? (
        <span className="ui-number__out" style={delay(cell.rank)}>
          {cell.from}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A live number. It diffs the formatted text and rolls only the digits that changed, last digit
 * first, up when the value rose and down when it fell; a big jump counts up instead; a quiet change
 * swaps without a sound. Width never moves (tabular figures in fixed cells). It follows the motion
 * setting: reduced swaps instantly with a 1 s tint, off just swaps. Screen readers get the final
 * text once, from a visually hidden element; nothing is announced per tick. The root carries
 * `data-font`, `data-mode` (the motion mode in force) and `data-state` (`unknown`, `counting` while a
 * count-up runs, otherwise `steady`).
 */
export function AnimatedNumber({
  value,
  format = formatInt,
  font = 'display',
  tint,
  roll = true,
  countUpOnMount = false,
  maxHz = 1,
  className,
  ...rest
}: AnimatedNumberProps) {
  const mode = useMotionMode();
  const view = useOdometer(value, { format, roll, tint: tint ?? roll, maxHz, countUpOnMount, mode });

  if (view.target === null) {
    return (
      <span
        {...rest}
        className={cx('ui-number', className)}
        data-font={font}
        data-mode={mode}
        data-state="unknown"
      >
        <span className="ui-unknown">{UNKNOWN}</span>
      </span>
    );
  }

  const settled = format(view.target);
  const text = view.frame ?? settled;
  const cells = view.plan && view.plan.text === text ? view.plan.cells : staticCells(text);
  return (
    <span
      {...rest}
      className={cx('ui-number', className)}
      data-font={font}
      data-mode={mode}
      data-state={view.frame === null ? 'steady' : 'counting'}
    >
      <span className="ui-sr-only">{settled}</span>
      <span key={view.seq} className="ui-number__live" aria-hidden="true" data-tint={view.tint ?? undefined}>
        {cells.map((cell) => (
          // Keyed by distance from the right, so a digit's element survives while its text changes.
          <Glyph key={cell.pos} cell={cell} dir={view.dir} />
        ))}
      </span>
    </span>
  );
}
