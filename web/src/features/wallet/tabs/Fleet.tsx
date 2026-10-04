// Fleet: every node paid to this address, as a table that holds a thousand of them. Filter it, group it, choose the
// columns, sort it, point at a row to find the node on the globe, and download what is on screen. The strip above it
// summarises whatever the filters left; a grouping adds a table of the groups that doubles as a way to drill in.

import { Download, Globe, Server } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo } from 'react';
import { formatInt } from '../../../lib/format';
import { Button, Chip, EmptyState, EntityLink } from '../../../ui';
import { useWalletCtx } from '../context';
import { useFleetView } from '../hooks/useFleetView';
import { SELECT_LIMIT } from '../hooks/useGlobeActions';
import { csvFilename, downloadCsv, toCsv } from '../lib/csv';
import {
  activeFilters,
  type ColumnId,
  columnSpec,
  facetsOf,
  filterFleet,
  groupFleet,
  isFiltered,
  nodesCsvHeader,
  nodesCsvRows,
  sortFleet,
  summarizeRows,
} from '../lib/fleet';
import { useWalletPrefs } from '../prefs';
import { Panel } from '../ui/Panel';
import { Groups } from './fleet/Groups';
import { NodeTable } from './fleet/NodeTable';
import { Strip } from './fleet/Strip';
import { Toolbar } from './fleet/Toolbar';
import './fleet.css';

export function FleetTab() {
  const { fleet, dto, globe, addr } = useWalletCtx();
  const view = useFleetView(addr);
  const columns = useWalletPrefs((s) => s.columns);
  const density = useWalletPrefs((s) => s.density);
  const groupBy = useWalletPrefs((s) => s.groupBy);
  const setColumns = useWalletPrefs((s) => s.setColumns);
  const setDensity = useWalletPrefs((s) => s.setDensity);
  const setGroupBy = useWalletPrefs((s) => s.setGroupBy);

  // Typing filters a thousand rows; the field stays instant and the table follows when the typing pauses.
  const text = useDeferredValue(view.filter.text);
  const filter = useMemo(() => ({ ...view.filter, text }), [view.filter, text]);

  const all = useMemo(() => summarizeRows(fleet.rows), [fleet.rows]);
  const facets = useMemo(() => facetsOf(fleet.rows), [fleet.rows]);
  const kept = useMemo(() => filterFleet(fleet.rows, filter), [fleet.rows, filter]);
  const shown = useMemo(() => sortFleet(kept, view.sort), [kept, view.sort]);
  const summary = useMemo(() => summarizeRows(shown), [shown]);
  const groups = useMemo(() => groupFleet(shown, groupBy), [shown, groupBy]);
  // The search text is in its own field; the chips are for everything chosen in the filters.
  const chips = useMemo(
    () => activeFilters(view.filter, facets).filter((c) => c.id !== 'text'),
    [view.filter, facets],
  );

  const total = fleet.rows.length;
  const filtered = isFiltered(view.filter);

  const exportCsv = useCallback(() => {
    downloadCsv(csvFilename('nodes', dto.address, Date.now()), toCsv(nodesCsvHeader(), nodesCsvRows(shown)));
  }, [shown, dto.address]);

  if (total === 0) {
    return (
      <div className="wl-page wl-fleet">
        <Panel title="Fleet">
          <EmptyState compact icon={Server} title="No node is paid to this address">
            A wallet's fleet is the nodes whose rewards go to it. When one is started with this address as its
            payment address it appears here, with its place in the payment queue.{' '}
            <EntityLink kind="address" value={dto.address}>
              Open the address in the explorer
            </EntityLink>
            .
          </EmptyState>
        </Panel>
      </div>
    );
  }

  const sortSpec = view.sort ? columnSpec(view.sort.id as ColumnId) : null;
  const sortWords = sortSpec
    ? `sorted by ${sortSpec.label.toLowerCase()}, ${view.sort?.dir === 'asc' ? 'ascending' : 'descending'}`
    : 'in roster order';
  const count = `${formatInt(shown.length)} of ${formatInt(total)} ${total === 1 ? 'node' : 'nodes'}`;
  const showing = globe.isShowing(shown);

  return (
    <div className="wl-page wl-fleet" data-density={density}>
      <Panel
        title="Fleet"
        aside={
          filtered ? `${count} match the filters` : `${formatInt(total)} ${total === 1 ? 'node' : 'nodes'}`
        }
      >
        <Strip s={summary} total={total} />
      </Panel>

      {groupBy === 'none' ? null : (
        <Groups by={groupBy} groups={groups} filter={view.filter} onPick={view.filterBy} />
      )}

      <Panel
        title="Nodes"
        aside={`${count}, ${sortWords}${fleet.live ? '' : ', status from the last server check'}`}
        actions={
          <>
            <Button
              size="sm"
              icon={Globe}
              aria-pressed={showing}
              disabled={!globe.ready || shown.length === 0}
              title={
                shown.length > SELECT_LIMIT
                  ? `Show the ${SELECT_LIMIT} of these paid soonest on the globe`
                  : 'Show these nodes on the globe'
              }
              onClick={() => globe.showRows(shown)}
            >
              {showing ? 'On the globe' : 'Show on globe'}
            </Button>
            <Button
              size="sm"
              icon={Download}
              disabled={shown.length === 0}
              title="Download the nodes as they are listed here"
              onClick={exportCsv}
            >
              Export CSV
            </Button>
          </>
        }
      >
        <Toolbar
          filter={view.filter}
          onFilter={view.filterBy}
          facets={facets}
          all={all}
          onClear={view.clearFilters}
          columns={columns}
          onColumns={setColumns}
          groupBy={groupBy}
          onGroupBy={setGroupBy}
          density={density}
          onDensity={setDensity}
        />
        {chips.length > 0 ? (
          <fieldset className="wl-fchips">
            <legend className="ui-sr-only">Filters that are set</legend>
            {chips.map((c) => (
              <Chip
                key={c.id}
                tone="accent"
                selected
                onClick={() => view.filterBy(c.clear)}
                title="Remove this filter"
                aria-label={`${c.label}. Remove this filter`}
              >
                {c.label}
              </Chip>
            ))}
            <Button size="sm" variant="ghost" onClick={view.clearFilters}>
              Clear all
            </Button>
          </fieldset>
        ) : null}
        <NodeTable
          rows={shown}
          columns={columns}
          density={density}
          sort={view.sort}
          onSort={view.setSort}
          filtered={filtered}
          onClear={view.clearFilters}
        />
        <p className="ui-sr-only" role="status">
          {count} shown, {sortWords}
        </p>
      </Panel>
    </div>
  );
}
