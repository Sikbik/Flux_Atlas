// The pieces a palette row is made of: the icon tile, the matched-prefix title, the type chip, and the
// meta on the right. Key caps, status chips and the tier glyph are the UI kit's; what stays here is the
// row anatomy and the highlight. The results page and the terminal reuse them.

import { ArrowDown, ArrowUp, Check, CornerDownLeft } from 'lucide-react';
import { memo } from 'react';
import { Kbd, KbdCombo, Skeleton, StatusChip } from '../../../ui';
import { RowIcon } from '../icons';
import { altKeyLabel, modKeyLabel } from '../keys';
import { highlight } from './rank';
import './rows.css';
import type { PaletteRow, RowMeta } from './types';

/** The word a key token stands for (`mod` is Ctrl or the command key, `alt` is Alt or the option key). */
export function keyLabel(k: string): string {
  switch (k) {
    case 'mod':
      return modKeyLabel();
    case 'alt':
      return altKeyLabel();
    default:
      return k;
  }
}

/** One key cap per key, never "Ctrl+K" as one string (design 8.9): the kit's Kbd, with arrows as glyphs. */
export function KeyCap({ k }: { k: string }) {
  switch (k) {
    case 'up':
      return (
        <Kbd>
          <ArrowUp size={11} strokeWidth={2.2} aria-label="up" />
        </Kbd>
      );
    case 'down':
      return (
        <Kbd>
          <ArrowDown size={11} strokeWidth={2.2} aria-label="down" />
        </Kbd>
      );
    case 'return':
      return (
        <Kbd>
          <CornerDownLeft size={11} strokeWidth={2.2} aria-label="enter" />
        </Kbd>
      );
    default:
      return <Kbd>{keyLabel(k)}</Kbd>;
  }
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
      return <StatusChip size="sm" status={meta.status} />;
    case 'keys':
      return <KbdCombo keys={meta.keys.map(keyLabel)} />;
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

const SKELETON_SLOTS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

/** Placeholder rows with the geometry of a result row (icon tile, title, sub-line), never a spinner. */
export function RowSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div className="pal-skels" aria-hidden="true">
      {SKELETON_SLOTS.slice(0, count).map((slot, i) => (
        <div key={slot} className="pal-skel" style={{ '--i': i } as React.CSSProperties}>
          <Skeleton className="pal-skel-ic" w={30} h={30} radius={9} />
          <span>
            <Skeleton w={190} h={11} radius={4} />
            <Skeleton w={120} h={9} radius={4} />
          </span>
        </div>
      ))}
    </div>
  );
}
