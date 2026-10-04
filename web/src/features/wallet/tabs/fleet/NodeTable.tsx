// The fleet's nodes as a table: sortable, windowed past two hundred rows, and wired to the globe. A pointer resting on
// a row (or the keyboard moving to one) pings that node on the globe; a click opens the node. A payment that lands
// while the page is open washes over the row of the node it paid.

import { SearchX, Server } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useMemo, useRef } from 'react';
import { useFresh } from '../../../../motion';
import { Button, DataTable, EmptyState, type SortState } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { useOpenNode } from '../../hooks/useOpenNode';
import type { ColumnId, FleetRow } from '../../lib/fleet';
import type { Density } from '../../prefs';
import { type AttentionMap, buildColumns } from './columns';

const rowKey = (r: FleetRow): string => r.key;

const ROW_HEIGHT: Record<Density, number | 'compact'> = { comfortable: 38, compact: 'compact' };
const MAX_HEIGHT: Record<Density, string> = { comfortable: 'min(70vh, 740px)', compact: 'min(66vh, 640px)' };

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export interface NodeTableProps {
  /** The rows in the order they are shown (the table does not sort them). */
  rows: readonly FleetRow[];
  columns: readonly ColumnId[];
  density: Density;
  sort: SortState | null;
  onSort: (sort: SortState | null) => void;
  /** Some filter is set, so an empty table means "nothing matches" rather than "no nodes". */
  filtered: boolean;
  onClear: () => void;
}

export function NodeTable({ rows, columns: ids, density, sort, onSort, filtered, onClear }: NodeTableProps) {
  const { dto, globe, landings, addr } = useWalletCtx();
  const open = useOpenNode();

  const attention = useMemo<AttentionMap>(
    () => new Map(dto.health.attention.map((a) => [a.node_key, a])),
    [dto.health.attention],
  );
  const columns = useMemo(() => buildColumns(ids, attention), [ids, attention]);

  // A payment landing washes over the nodes it paid; a refill of the list (a refetch) is not news.
  const landed = useMemo(() => landings.flatMap((l) => l.keys), [landings]);
  const fresh = useFresh(landed, { ms: 6_000, max: 3, scope: addr });

  const hovered = useRef<string | null>(null);
  const ping = (row: FleetRow | null) => {
    const key = row?.key ?? null;
    if (key === hovered.current) return;
    hovered.current = key;
    globe.hover(row);
  };
  const rowOf = (el: Element | null): FleetRow | null => {
    const at = el?.closest<HTMLElement>('[role="row"][data-index]');
    return at ? (rows[Number(at.dataset.index)] ?? null) : null;
  };

  const onPointerOver = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    ping(rowOf(e.target as Element));
  };
  // The grid's active row follows the arrow keys (`aria-activedescendant`); the node there is pinged too.
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.has(e.key)) return;
    const grid = e.target as HTMLElement;
    if (grid.getAttribute('role') !== 'grid') return;
    const id = grid.getAttribute('aria-activedescendant');
    ping(rowOf(id ? document.getElementById(id) : null));
  };

  return (
    // The wrapper only listens: the grid inside is the single tab stop.
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer and key events bubble from the grid so a row can ping its node
    <div
      className="wl-nodetable"
      onPointerOver={onPointerOver}
      onPointerLeave={() => ping(null)}
      onKeyUp={onKeyUp}
      onBlur={() => ping(null)}
    >
      <DataTable
        aria-label="Nodes paid to this address"
        rows={rows}
        columns={columns}
        rowKey={rowKey}
        sort={sort}
        onSortChange={onSort}
        manualSort
        onRowClick={(r) => {
          if (r.key.includes(':')) open(r.key);
        }}
        highlightKeys={fresh}
        rowHeight={ROW_HEIGHT[density]}
        maxHeight={MAX_HEIGHT[density]}
        empty={
          filtered ? (
            <EmptyState
              compact
              icon={SearchX}
              title="No node matches these filters"
              action={
                <Button size="sm" onClick={onClear}>
                  Clear the filters
                </Button>
              }
            >
              Loosen a filter, or clear them to see every node of this wallet again.
            </EmptyState>
          ) : (
            <EmptyState compact icon={Server} title="No nodes to show" />
          )
        }
      />
    </div>
  );
}
