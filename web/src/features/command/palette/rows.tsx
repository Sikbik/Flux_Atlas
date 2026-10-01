// The pieces a palette row is made of: the icon tile, the matched-prefix title, the type chip, status
// chips and key caps. The results page and the terminal reuse them.

import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleCheck,
  CircleDot,
  CircleMinus,
  CornerDownLeft,
  OctagonX,
  TriangleAlert,
} from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { RowIcon } from '../icons';
import { altKeyLabel, modKeyLabel } from '../keys';
import { highlight } from './rank';
import './rows.css';
import type { PaletteRow, RowMeta, StatusTone } from './types';

/** A key cap per key, never "Ctrl+K" as one string (design 8.9). */
export function KeyCap({ k }: { k: string }) {
  let label: ReactNode = k;
  switch (k) {
    case 'up':
      label = <ArrowUp size={11} strokeWidth={2.2} aria-label="up" />;
      break;
    case 'down':
      label = <ArrowDown size={11} strokeWidth={2.2} aria-label="down" />;
      break;
    case 'enter':
      label = 'enter';
      break;
    case 'return':
      label = <CornerDownLeft size={11} strokeWidth={2.2} aria-label="enter" />;
      break;
    case 'mod':
      label = modKeyLabel();
      break;
    case 'alt':
      label = altKeyLabel();
      break;
    default:
      label = k;
  }
  return <kbd className="pal-kbd">{label}</kbd>;
}

export function KeyCaps({ keys }: { keys: readonly string[] }) {
  return (
    <span className="pal-keys">
      {keys.map((k) => (
        <KeyCap key={k} k={k} />
      ))}
    </span>
  );
}

const STATUS_ICON: Record<StatusTone, typeof CircleCheck> = {
  ok: CircleCheck,
  pending: CircleDot,
  warn: TriangleAlert,
  crit: OctagonX,
  off: CircleMinus,
};

/** An icon and a word, so status is never colour alone (design 10.6). */
export function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  const Icon = STATUS_ICON[tone];
  return (
    <span className="pal-status" data-status={tone}>
      <Icon size={11} strokeWidth={2} aria-hidden="true" />
      {label}
    </span>
  );
}

/** The title with the part the query matched marked (the matched prefix reads as white semibold). */
export function Marked({ text, q }: { text: string; q: string }) {
  const parts = highlight(text, q);
  // Nothing matched, or the whole title matched (an exact hit needs no marker).
  if (parts.length === 1) return <>{text}</>;
  // Each piece is keyed by where it starts in the title: unique and stable for a given text.
  let at = 0;
  return (
    <>
      {parts.map((p) => {
        const key = at;
        at += p.text.length;
        return p.hit ? <mark key={key}>{p.text}</mark> : <span key={key}>{p.text}</span>;
      })}
    </>
  );
}

function Meta({ meta }: { meta: RowMeta }) {
  switch (meta.type) {
    case 'status':
      return <StatusChip tone={meta.tone} label={meta.label} />;
    case 'keys':
      return <KeyCaps keys={meta.keys} />;
    case 'text':
      return <span className="pal-metatext">{meta.text}</span>;
    case 'current':
      return (
        <span className="pal-current">
          <Check size={12} strokeWidth={2.4} aria-hidden="true" />
          Current
        </span>
      );
  }
}

/** DOM id of a row's option element (stable, selector safe). */
export function optionId(rowId: string): string {
  return `pal-opt-${rowId.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

export interface RowViewProps {
  row: PaletteRow;
  q: string;
  active: boolean;
  index: number;
  onHover?(row: PaletteRow): void;
  onPick(row: PaletteRow, e: React.MouseEvent): void;
  /** `option` is a listbox option driven by the palette's input; `button` is a real button (results page). */
  as?: 'option' | 'button';
}

function RowBody({ row, q, active }: { row: PaletteRow; q: string; active: boolean }) {
  const inert = row.action.type === 'none';
  return (
    <>
      <span className="pal-ic" data-tier={row.tier} data-kind={row.kind}>
        <RowIcon id={row.icon} tier={row.tier} />
      </span>
      <span className="pal-tx">
        <b className={row.mono ? 'pal-title mono' : 'pal-title'}>
          <Marked text={row.title} q={q} />
        </b>
        {row.sub ? <small className={row.subMono ? 'mono' : undefined}>{row.sub}</small> : null}
      </span>
      <span className="pal-meta">
        <span className="pal-chip">{row.chip}</span>
        {row.meta ? <Meta meta={row.meta} /> : null}
        <span className="pal-enter" aria-hidden="true">
          {active && !inert ? <KeyCap k="enter" /> : null}
        </span>
      </span>
    </>
  );
}

/** One result row: icon tile, title and sub-line, type chip, meta, and the enter cap on the active row. */
export const RowView = memo(function RowView({
  row,
  q,
  active,
  index,
  onHover,
  onPick,
  as = 'option',
}: RowViewProps) {
  const inert = row.action.type === 'none';
  const style = { '--i': Math.min(index, 9) } as React.CSSProperties;
  if (as === 'button') {
    return (
      <button
        type="button"
        className="pal-row"
        data-row={row.id}
        data-kind={row.kind}
        data-inert={inert || undefined}
        aria-disabled={inert || undefined}
        style={style}
        onClick={(e) => onPick(row, e)}
      >
        <RowBody row={row} q={q} active={false} />
      </button>
    );
  }
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard is handled by the combobox input (aria-activedescendant)
    <div
      role="option"
      id={optionId(row.id)}
      aria-selected={active}
      aria-disabled={inert || undefined}
      tabIndex={-1}
      className="pal-row"
      data-row={row.id}
      data-kind={row.kind}
      data-active={active || undefined}
      data-inert={inert || undefined}
      style={style}
      // The input keeps the keyboard: pressing a row must not take focus from it.
      onMouseDown={(e) => e.preventDefault()}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse' && !active) onHover?.(row);
      }}
      onClick={(e) => onPick(row, e)}
    >
      <RowBody row={row} q={q} active={active} />
    </div>
  );
});
