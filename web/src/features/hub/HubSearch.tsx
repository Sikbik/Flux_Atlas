// Search in place: the palette's own resolver, drawn inside a hub. Type a height, a hash, an address, an IP or an app
// name and the same rows the palette offers appear under the field, limited to the kinds this hub is about. A row
// opens its subject as a window alongside the hub, so the hub is still there when you close it. Arrow keys move
// between the field and the rows, Enter opens the best one, Escape clears.

import { useRouter } from '@tanstack/react-router';
import { SearchX } from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRuntime } from '../../app/context';
import { useGlobeHandles } from '../../globe';
import { Chip, EmptyState, SearchField } from '../../ui';
import { RowSkeletons, RowView } from '../command/palette/rows';
import { type RunCtx, type RunMode, runRow } from '../command/palette/run';
import type { GroupId, PaletteRow } from '../command/palette/types';
import { useSearchModel } from '../command/palette/useSearchModel';
import './hub.css';

export interface HubSearchExample {
  label: string;
  /** What the field is filled with when the example is chosen. */
  text: string;
}

export interface HubSearchProps {
  /** Names the field and its region ("Search the chain"). */
  label: string;
  placeholder: string;
  /** The palette groups this hub finds; every other group is left out. */
  groups: readonly GroupId[];
  /** Shown under the field while it is empty: what can be typed. */
  hint: ReactNode;
  examples?: readonly HubSearchExample[];
  /** What the list says when nothing matched (`No block, transaction or address matches 'x'`). */
  emptyTitle: (text: string) => string;
  emptyText: string;
}

const MODES = { plain: 'alongside', shift: 'open', alt: 'fly' } as const satisfies Record<string, RunMode>;

export function HubSearch({
  label,
  placeholder,
  groups,
  hint,
  examples,
  emptyTitle,
  emptyText,
}: HubSearchProps) {
  const router = useRouter();
  const { store, effects } = useRuntime();
  const handles = useGlobeHandles();
  const [text, setText] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const { model, server } = useSearchModel({ raw: text });
  const asked = text.trim() !== '';

  const shown = useMemo(
    () => (asked ? model.groups.filter((g) => groups.includes(g.id) && g.rows.length > 0) : []),
    [asked, model.groups, groups],
  );
  const rows = useMemo(() => shown.flatMap((g) => g.rows), [shown]);
  const loading = asked && server === 'loading';

  const ctx = useMemo<RunCtx>(
    () => ({
      router,
      store,
      effects,
      engine: () => handles.engine.get(),
      dismiss: () => setText(''),
      page: true,
    }),
    [router, store, effects, handles],
  );

  const run = useCallback(
    (row: PaletteRow, mode: RunMode) => {
      const result = runRow(row, mode, ctx);
      if (result.kind === 'text') setText(result.text);
      else if (result.kind === 'closed') setText('');
    },
    [ctx],
  );

  const onPick = useCallback(
    (row: PaletteRow, e: MouseEvent) =>
      run(row, e.altKey ? MODES.alt : e.shiftKey ? MODES.shift : MODES.plain),
    [run],
  );

  const focusables = (): HTMLElement[] => {
    const root = wrap.current;
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>('input[type="search"], button.pal-row')];
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = focusables();
      if (items.length < 2) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1);
      e.preventDefault();
      items[next]?.focus();
    } else if (e.key === 'Escape' && asked && (e.target as HTMLElement).tagName !== 'INPUT') {
      e.preventDefault();
      e.stopPropagation();
      setText('');
      focusables()[0]?.focus();
    }
  };

  const status = !asked
    ? ''
    : rows.length > 0
      ? `${rows.length} ${rows.length === 1 ? 'result' : 'results'}`
      : loading
        ? 'Searching'
        : 'No match';

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys are the arrow keys of the field and its rows
    <div ref={wrap} className="hub-search" onKeyDown={onKeyDown}>
      <SearchField
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onValueChange={setText}
        loading={loading}
        onSubmit={() => {
          const first = rows[0];
          if (first) run(first, MODES.plain);
        }}
      />
      <p className="ui-sr-only" role="status">
        {status}
      </p>
      {!asked ? (
        <div className="hub-search__idle">
          <p className="hub-search__hint">{hint}</p>
          {examples?.length ? (
            <ul className="hub-search__examples" aria-label="Examples">
              {examples.map((x) => (
                <li key={x.label}>
                  <Chip
                    size="sm"
                    mono
                    onClick={() => {
                      setText(x.text);
                      focusables()[0]?.focus();
                    }}
                  >
                    {x.label}
                  </Chip>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="hub-search__results" data-fx-density="dense">
          {shown.map((g) => (
            <div key={g.id} className="hub-search__group">
              <h3 className="pal-gh">
                <span>{g.label}</span>
                <span className="pal-gc">{g.rows.length}</span>
              </h3>
              {g.rows.map((r) => (
                <RowView key={r.id} row={r} q={model.input.text} active={false} as="button" onPick={onPick} />
              ))}
            </div>
          ))}
          {loading && rows.length === 0 ? <RowSkeletons count={2} /> : null}
          {!loading && rows.length === 0 ? (
            <EmptyState compact icon={SearchX} title={emptyTitle(text.trim())}>
              {emptyText}
            </EmptyState>
          ) : null}
        </div>
      )}
    </div>
  );
}
