// The fleet grouped: one row per tier, state, country, city, provider or FluxOS version, with what each group holds, how
// healthy it is, what it earns and when it is paid next. Choosing a group narrows the node table to it, and the globe
// button puts the group on the globe. A grouping is a way to ask "where is my money, and where is my risk".

import { Globe } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import { formatInt, formatPercent } from '../../../../lib/format';
import { DataTable, type DataTableColumn, IconButton, TierGlyph } from '../../../../ui';
import { useWalletCtx } from '../../context';
import {
  type FleetFilter,
  type FleetGroup,
  filterForGroup,
  GROUP_OPTIONS,
  type GroupBy,
  groupInFilter,
} from '../../lib/fleet';
import type { PayTier } from '../../types';
import { Eta } from '../../ui/Eta';
import { Panel } from '../../ui/Panel';

const rowKey = (g: FleetGroup): string => g.key;

function Nodes({ g, of }: { g: FleetGroup; of: number }) {
  return (
    <span className="wl-gnodes">
      <b className="ui-mono">{formatInt(g.nodes)}</b>
      <i
        className="wl-gnodes__bar"
        style={{ '--wl-share': of > 0 ? g.nodes / of : 0 } as CSSProperties}
        aria-hidden="true"
      />
    </span>
  );
}

function Health({ g }: { g: FleetGroup }) {
  const ok = g.nodes === 0 ? 0 : g.healthy / g.nodes;
  return (
    <span
      className="wl-ghealth"
      title={`${formatInt(g.healthy)} healthy, ${formatInt(g.trouble)} ${g.trouble === 1 ? 'needs' : 'need'} a look`}
    >
      <span className="wl-ghealth__bar" aria-hidden="true">
        <i data-kind="ok" style={{ flexGrow: g.healthy }} />
        <i data-kind="warn" style={{ flexGrow: g.trouble }} />
      </span>
      <span className="ui-mono">{formatPercent(ok, 0)}</span>
      <span className="ui-sr-only">{` healthy: ${formatInt(g.healthy)} of ${formatInt(g.nodes)}`}</span>
    </span>
  );
}

export interface GroupsProps {
  by: Exclude<GroupBy, 'none'>;
  groups: readonly FleetGroup[];
  filter: FleetFilter;
  onPick: (patch: Partial<FleetFilter>) => void;
}

export function Groups({ by, groups, filter, onPick }: GroupsProps) {
  const { globe } = useWalletCtx();
  const label = GROUP_OPTIONS.find((o) => o.value === by)?.label ?? 'Group';
  const picked = groupInFilter(by, filter);
  // The bars compare the groups with each other: the biggest fills its track.
  const biggest = useMemo(() => groups.reduce((m, g) => Math.max(m, g.nodes), 0), [groups]);

  const columns = useMemo<DataTableColumn<FleetGroup>[]>(
    () => [
      {
        id: 'group',
        header: label,
        sortable: true,
        minWidth: 180,
        width: '1.6fr',
        sortValue: (g) => g.label,
        cell: (g) => (
          <span className="wl-gname">
            {by === 'tier' ? <TierGlyph tier={g.key as PayTier} size={14} /> : null}
            <span>{g.label}</span>
          </span>
        ),
      },
      {
        id: 'nodes',
        header: 'Nodes',
        numeric: true,
        sortable: true,
        minWidth: 132,
        sortValue: (g) => g.nodes,
        cell: (g) => <Nodes g={g} of={biggest} />,
      },
      {
        id: 'health',
        header: 'Healthy',
        numeric: true,
        sortable: true,
        minWidth: 120,
        sortValue: (g) => (g.nodes === 0 ? 0 : g.healthy / g.nodes),
        cell: (g) => <Health g={g} />,
      },
      {
        id: 'perDay',
        header: 'FLUX a day',
        numeric: true,
        sortable: true,
        minWidth: 104,
        sortValue: (g) => g.perDay,
        cell: (g) => (g.perDay === null ? null : g.perDay.toFixed(2)),
      },
      {
        id: 'next',
        header: 'Paid next',
        numeric: true,
        sortable: true,
        minWidth: 104,
        sortValue: (g) => g.nextEtaMs,
        cell: (g) => (g.nextEtaMs === null ? null : <Eta at={g.nextEtaMs} className="ui-mono" />),
      },
      {
        id: 'apps',
        header: 'Apps',
        numeric: true,
        sortable: true,
        minWidth: 72,
        sortValue: (g) => g.apps,
        cell: (g) => formatInt(g.apps),
      },
      {
        id: 'globe',
        header: <span className="ui-sr-only">Show on the globe</span>,
        width: 52,
        minWidth: 52,
        align: 'end',
        cell: (g) => (
          <IconButton
            size="sm"
            variant="ghost"
            icon={Globe}
            label={`Show the ${formatInt(g.nodes)} ${g.nodes === 1 ? 'node' : 'nodes'} of ${g.label} on the globe`}
            aria-pressed={globe.isShowing(g.rows)}
            disabled={!globe.ready}
            onClick={() => globe.showRows(g.rows)}
          />
        ),
      },
    ],
    [by, label, biggest, globe],
  );

  return (
    <Panel
      title={`By ${label.toLowerCase()}`}
      aside={`${formatInt(groups.length)} ${groups.length === 1 ? 'group' : 'groups'}, choose one to see its nodes`}
    >
      <DataTable
        aria-label={`The fleet grouped by ${label.toLowerCase()}`}
        rows={groups}
        columns={columns}
        rowKey={rowKey}
        rowHeight={40}
        maxHeight={360}
        selectedKey={picked}
        onRowClick={(g) => {
          const patch = filterForGroup(by, g.key);
          if (patch) onPick(patch);
        }}
      />
    </Panel>
  );
}
