// Every app of the fleet as a table: its instances, its share of all of them and the nodes it runs on, with a search
// above. It is the picture's twin, and the way into it by keyboard: choosing a row chooses the app in both. A new app
// arriving while the page is open washes over its row.

import { SearchX } from 'lucide-react';
import { type CSSProperties, useDeferredValue, useMemo, useRef, useState } from 'react';
import { formatInt, formatPercent } from '../../../../lib/format';
import { useFresh } from '../../../../motion';
import { Button, DataTable, type DataTableColumn, EmptyState, SearchField } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { useBoxWidth } from '../../hooks/useBoxWidth';
import { type AppRow, appColorSlot, filterAppRows } from '../../lib/apps';
import { Panel } from '../../ui/Panel';

const rowKey = (r: AppRow): string => r.name;

/** Under this width the table drops its share column. */
const NARROW = 560;

function Name({ r }: { r: AppRow }) {
  return (
    <span className="wl-aname">
      <i
        className="wl-aname__dot"
        style={{ '--wl-c': `var(--viz-${appColorSlot(r.name)})` } as CSSProperties}
        aria-hidden="true"
      />
      <span className="wl-aname__text">{r.label}</span>
    </span>
  );
}

function Share({ r, biggest }: { r: AppRow; biggest: number }) {
  return (
    <span className="wl-ashare">
      <i
        className="wl-ashare__bar"
        style={
          {
            '--wl-share': biggest > 0 ? r.instances / biggest : 0,
            '--wl-c': `var(--viz-${appColorSlot(r.name)})`,
          } as CSSProperties
        }
        aria-hidden="true"
      />
      <span className="ui-mono">{formatPercent(r.share, r.share < 0.1 ? 1 : 0)}</span>
    </span>
  );
}

export interface AppTableProps {
  rows: readonly AppRow[];
  selected: string | null;
  onSelect: (name: string | null) => void;
}

export function AppTable({ rows, selected, onSelect }: AppTableProps) {
  const { addr } = useWalletCtx();
  const [text, setText] = useState('');
  // Typing filters a thousand rows; the field stays instant and the table follows when the typing pauses.
  const needle = useDeferredValue(text);
  const shown = useMemo(() => filterAppRows(rows, needle), [rows, needle]);
  const biggest = useMemo(() => rows.reduce((m, r) => Math.max(m, r.instances), 0), [rows]);

  const names = useMemo(() => rows.map((r) => r.name), [rows]);
  const fresh = useFresh(names, { ms: 6_000, max: 3, scope: addr });

  // The share of all is the instances again, as a bar: a window too narrow for four columns keeps the three that count.
  const wrap = useRef<HTMLDivElement>(null);
  const width = useBoxWidth(wrap);
  const narrow = width > 0 && width < NARROW;

  const columns = useMemo<DataTableColumn<AppRow>[]>(
    () => [
      {
        id: 'app',
        header: 'App',
        sortable: true,
        width: '1.8fr',
        minWidth: narrow ? 140 : 190,
        sortValue: (r) => r.label.toLowerCase(),
        cell: (r) => <Name r={r} />,
      },
      {
        id: 'instances',
        header: 'Instances',
        numeric: true,
        sortable: true,
        minWidth: 100,
        sortValue: (r) => r.instances,
        cell: (r) => formatInt(r.instances),
      },
      ...(narrow
        ? []
        : [
            {
              id: 'share',
              header: 'Of all',
              numeric: true,
              minWidth: 150,
              cell: (r: AppRow) => <Share r={r} biggest={biggest} />,
            },
          ]),
      {
        id: 'nodes',
        header: 'Nodes',
        numeric: true,
        sortable: true,
        minWidth: 76,
        sortValue: (r) => r.nodes,
        cell: (r) => formatInt(r.nodes),
      },
    ],
    [biggest, narrow],
  );

  const count =
    needle.trim() === ''
      ? `${formatInt(rows.length)} ${rows.length === 1 ? 'app' : 'apps'}`
      : `${formatInt(shown.length)} of ${formatInt(rows.length)} apps match`;

  return (
    <Panel title="All apps" aside={count}>
      <SearchField
        className="wl-appsearch"
        size="sm"
        aria-label="Search the apps"
        placeholder="Search by name"
        value={text}
        onValueChange={setText}
      />
      <div ref={wrap}>
        <DataTable
          aria-label="Apps running on the fleet"
          rows={shown}
          columns={columns}
          rowKey={rowKey}
          defaultSort={{ id: 'instances', dir: 'desc' }}
          selectedKey={selected}
          onRowClick={(r) => onSelect(selected === r.name ? null : r.name)}
          highlightKeys={fresh}
          rowHeight={40}
          maxHeight="min(62vh, 560px)"
          empty={
            <EmptyState
              compact
              icon={SearchX}
              title="No app matches"
              action={
                <Button size="sm" onClick={() => setText('')}>
                  Clear the search
                </Button>
              }
            >
              No app of this fleet has that in its name.
            </EmptyState>
          }
        />
      </div>
      <p className="ui-sr-only" role="status">
        {count}
      </p>
    </Panel>
  );
}
