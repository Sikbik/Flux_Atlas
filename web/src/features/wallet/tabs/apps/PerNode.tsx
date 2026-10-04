// How many apps each node runs, as a short distribution: none, one, two and so on up to five or more. A node that runs
// none is spare capacity; one that runs many is where a failure would take the most with it. Every row is a way into the
// Fleet tab with exactly those nodes in the table.

import { useMemo } from 'react';
import { formatInt, formatPercent } from '../../../../lib/format';
import { BarList, type BarListItem } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { showInFleet } from '../../hooks/useFleetView';
import { type AppCountBucket, appCountHeadline } from '../../lib/apps';
import { Panel } from '../../ui/Panel';

/** What the fleet table's chip says for the nodes of a bucket. */
function phrase(b: AppCountBucket): string {
  if (b.id === '0') return 'Running no app';
  return b.id.endsWith('+') ? `Running ${b.label} apps` : `Running ${b.label}`;
}

export interface PerNodeProps {
  buckets: readonly AppCountBucket[];
  /** Nodes in the fleet. */
  nodes: number;
}

export function PerNode({ buckets, nodes }: PerNodeProps) {
  const { addr, setTab } = useWalletCtx();

  const items = useMemo<BarListItem[]>(
    () =>
      buckets.map((b) => ({
        id: b.id,
        label: b.label,
        title: `${b.label}: ${formatInt(b.nodes)} ${b.nodes === 1 ? 'node' : 'nodes'}`,
        value: b.nodes,
        display: formatInt(b.nodes),
        detail: nodes > 0 ? formatPercent(b.nodes / nodes, 0) : undefined,
        color: b.id === '0' ? 'var(--viz-other)' : undefined,
        onSelect:
          b.nodes > 0
            ? () => {
                showInFleet(addr, { only: { label: phrase(b), keys: b.keys } });
                setTab('fleet');
              }
            : undefined,
      })),
    [buckets, nodes, addr, setTab],
  );

  return (
    <Panel title="Apps a node runs" aside="choose a row to see those nodes in the fleet table">
      <p className="wl-note">{appCountHeadline(buckets, nodes)}</p>
      <BarList
        label="Nodes by how many apps they run"
        items={items}
        total={Math.max(1, nodes)}
        labelWidth="minmax(96px, 38%)"
      />
    </Panel>
  );
}
