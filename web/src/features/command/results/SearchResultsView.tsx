// `/q/$text`: every match for a text, grouped by kind. The palette shows the best few; this page is where
// "See all results" and the `#all` form of the route land, and where an ambiguous text that resolved to
// nothing routable ends up. The same model feeds both, so a row looks and behaves the same in each.

import { useRouter } from '@tanstack/react-router';
import { Search, SearchX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRuntime } from '../../../app/context';
import { useGlobeHandles } from '../../../globe';
import { formatInt } from '../../../lib/format';
import { EmptyState, IconButton, SearchField, type TabItem, Tabs, ViewHeader } from '../../../ui';
import { PAGE_LIMITS } from '../palette/model';
import { RowSkeletons, RowView } from '../palette/rows';
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
  const { store, effects } = useRuntime();
  const handles = useGlobeHandles();
  const [chip, setChip] = useState<KindChip>('all');
  const { model, server } = useSearchModel({ raw: text, chip, limits: PAGE_LIMITS, ask: 'all' });

  const ctx = useMemo<RunCtx>(
    () => ({ router, store, effects, engine: () => handles.engine.get(), dismiss: () => {}, page: true }),
    [router, store, effects, handles],
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

  const refine = (value: string) => {
    const v = value.trim();
    if (!v || v === text) return;
    void router.navigate({ to: '/q/$text', params: { text: v }, hash: 'all', replace: true } as never);
  };

  const loading = server === 'loading';
  let index = 0;

  const kinds = useMemo<TabItem<KindChip>[]>(
    () =>
      KIND_CHIPS.map((k) => {
        const n = model.counts[k.id];
        return { id: k.id, label: k.label, ...(k.id !== 'all' && n > 0 ? { badge: n } : {}) };
      }),
    [model.counts],
  );

  return (
    <section className="res-panel" aria-label={`Results for ${text}`}>
      <ViewHeader
        kind="Search"
        icon={Search}
        title={
          <>
            Results for <span className="res-q">{text}</span>
          </>
        }
        subtitle={
          <span className="res-sum" aria-live="polite">
            {summary(model, loading)}
          </span>
        }
      />
      <IconButton
        className="res-close"
        icon={X}
        label="Close the results"
        size="sm"
        variant="secondary"
        onClick={close}
      />

      <div className="res-tools">
        <SearchField
          key={text}
          aria-label="Refine the search"
          placeholder="Refine the search"
          defaultValue={text}
          loading={loading}
          onSubmit={refine}
        />
        <Tabs size="sm" aria-label="Kind of result" items={kinds} value={chip} onChange={setChip} />
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
        {loading && model.groups.length === 0 ? <RowSkeletons count={4} /> : null}
        {!loading && model.empty ? (
          <EmptyState
            compact
            className="pal-empty"
            icon={SearchX}
            role="status"
            title={`No match for '${text}'`}
          >
            Try a block height, a hash, a transaction id, an address, an IP with a port, or an app name.
          </EmptyState>
        ) : null}
      </div>
    </section>
  );
}

export default SearchResultsView;
