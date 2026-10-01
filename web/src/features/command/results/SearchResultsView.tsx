// `/q/$text`: every match for a text, grouped by kind. The palette shows the best few; this page is where
// "See all results" and the `#all` form of the route land, and where an ambiguous text that resolved to
// nothing routable ends up. The same model feeds both, so a row looks and behaves the same in each.

import { useRouter } from '@tanstack/react-router';
import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRuntime } from '../../../app/context';
import { useGlobeHandles } from '../../../globe';
import { formatInt } from '../../../lib/format';
import { PAGE_LIMITS } from '../palette/model';
import { RowView } from '../palette/rows';
import { type RunCtx, type RunMode, runRow } from '../palette/run';
import { KIND_CHIPS, type KindChip, type PaletteModel, type PaletteRow } from '../palette/types';
import { useSearchModel } from '../palette/useSearchModel';
import './results.css';

function summary(model: PaletteModel, loading: boolean): string {
  if (loading && model.groups.length === 0) return 'Looking through the network.';
  const total = model.groups.reduce((n, g) => n + g.rows.length + g.more, 0);
  if (total === 0) return 'Nothing matched.';
  const kinds = model.groups.map((g) => g.label.toLowerCase());
  const list =
    kinds.length === 1 ? kinds[0]! : `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}`;
  return `${formatInt(total)} ${total === 1 ? 'match' : 'matches'} across ${list}.`;
}

export function SearchResultsView({ text }: { text: string }) {
  const router = useRouter();
  const { store } = useRuntime();
  const handles = useGlobeHandles();
  const [chip, setChip] = useState<KindChip>('all');
  const { model, server } = useSearchModel({ raw: text, chip, limits: PAGE_LIMITS, ask: 'all' });
  const inputRef = useRef<HTMLInputElement>(null);

  const ctx = useMemo<RunCtx>(
    () => ({ router, store, engine: () => handles.engine.get(), dismiss: () => {}, page: true }),
    [router, store, handles],
  );

  const close = useCallback(() => {
    if (router.history.canGoBack()) router.history.back();
    else void router.navigate({ to: '/', replace: true } as never);
  }, [router]);

  // Escape leaves the page (from anywhere on it).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [close]);

  const onPick = useCallback(
    (row: PaletteRow, e: React.MouseEvent) => {
      const mode: RunMode = e.altKey ? 'fly' : e.shiftKey ? 'alongside' : 'open';
      runRow(row, mode, ctx);
    },
    [ctx],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = inputRef.current?.value.trim() ?? '';
    if (!v || v === text) return;
    void router.navigate({ to: '/q/$text', params: { text: v }, hash: 'all', replace: true } as never);
  };

  const loading = server === 'loading';
  let index = 0;

  return (
    <section className="res-panel" aria-labelledby="res-title">
      <header className="res-head">
        <div className="res-heading">
          <p className="res-eyebrow">Search</p>
          <h1 id="res-title" className="res-title">
            Results for <span className="res-q">{text}</span>
          </h1>
          <p className="res-sum" aria-live="polite">
            {summary(model, loading)}
          </p>
        </div>
        <button type="button" className="res-close" onClick={close} aria-label="Close the results">
          <X size={16} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </header>

      {/* biome-ignore lint/a11y/useSemanticElements: the form is itself the search landmark; <search> would add a wrapper the layout does not need */}
      <form className="res-refine" onSubmit={onSubmit} role="search">
        <Search size={16} strokeWidth={1.9} aria-hidden="true" />
        <input
          ref={inputRef}
          key={text}
          defaultValue={text}
          type="text"
          aria-label="Refine the search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Refine the search"
        />
      </form>

      <div className="res-kinds" role="radiogroup" aria-label="Kind of result">
        {KIND_CHIPS.map((k) => {
          const n = model.counts[k.id];
          return (
            // biome-ignore lint/a11y/useSemanticElements: a segmented control; native radios cannot take this look
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={chip === k.id}
              className="pal-kind"
              data-on={chip === k.id ? '' : undefined}
              onClick={() => setChip(k.id)}
            >
              {k.label}
              {k.id !== 'all' && n > 0 ? <i>{n}</i> : null}
            </button>
          );
        })}
      </div>

      <div className="res-body">
        {model.groups.map((g) => (
          <div key={g.id} className="res-group">
            <h2 className="pal-gh">
              <span>{g.label}</span>
              <span className="pal-gc">
                {g.more > 0 ? `${g.rows.length} of ${g.rows.length + g.more}` : g.rows.length}
              </span>
            </h2>
            {g.rows.map((r) => (
              <RowView
                key={r.id}
                row={r}
                q={model.input.text}
                active={false}
                index={index++}
                as="button"
                onPick={onPick}
              />
            ))}
            {g.more > 0 ? (
              <p className="res-more">
                Showing {g.rows.length} of {formatInt(g.rows.length + g.more)}. Narrow the search to see the
                rest.
              </p>
            ) : null}
          </div>
        ))}
        {loading && model.groups.length === 0 ? (
          <div className="pal-skels" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="pal-skel" style={{ '--i': i } as React.CSSProperties}>
                <i className="pal-skel-ic" />
                <span>
                  <i className="pal-skel-a" />
                  <i className="pal-skel-b" />
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {!loading && model.empty ? (
          <div className="pal-empty">
            <b>No match for '{text}'</b>
            <p>
              Try a block height, a hash, a transaction id, an address, an IP with a port, or an app name.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default SearchResultsView;
