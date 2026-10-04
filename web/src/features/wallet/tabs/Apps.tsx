// Apps: what runs on the fleet. A treemap sizes every app by its instances, a table lists them all and is the keyboard's
// way to the same choice, and a chosen app says which nodes run it, with a way to those nodes in the Fleet tab and on the
// globe. Under them, how many apps each node runs: the spare capacity and the heavy nodes at a glance.

import { Boxes } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatInt } from '../../../lib/format';
import { EmptyState, EntityLink } from '../../../ui';
import { useWalletCtx } from '../context';
import { appCountBuckets, appRows, perNodeCounts, summarizeApps } from '../lib/apps';
import { Panel } from '../ui/Panel';
import { AppsTreemap } from '../viz/AppsTreemap';
import { AppTable } from './apps/AppTable';
import { AppDetail, DETAIL_ID, TopApps } from './apps/Detail';
import { PerNode } from './apps/PerNode';
import { Strip } from './apps/Strip';
import './apps.css';

/** The width of the wallet window under which its two-column rows (`wl-duo`) become one. */
const ONE_COLUMN = 860;

export function AppsTab() {
  const { dto, fleet } = useWalletCtx();
  const [selected, setSelected] = useState<string | null>(null);

  const apps = dto.apps.apps;
  const rows = useMemo(
    () => appRows(apps).sort((a, b) => b.instances - a.instances || a.label.localeCompare(b.label)),
    [apps],
  );
  const nodeKeys = useMemo(() => fleet.rows.map((r) => r.key), [fleet.rows]);
  const counts = useMemo(() => perNodeCounts(apps), [apps]);
  const summary = useMemo(() => summarizeApps(apps, nodeKeys), [apps, nodeKeys]);
  const buckets = useMemo(() => appCountBuckets(counts, nodeKeys), [counts, nodeKeys]);
  const chosen = useMemo(() => rows.find((r) => r.name === selected) ?? null, [rows, selected]);

  // Where the layout is one column the chosen app's panel sits below the picture: bring it into view.
  const name = chosen?.name ?? null;
  useEffect(() => {
    if (name === null) return;
    const el = document.getElementById(DETAIL_ID);
    const width = el?.closest('.wl')?.clientWidth ?? Number.POSITIVE_INFINITY;
    if (width < ONE_COLUMN) el?.scrollIntoView?.({ block: 'nearest' });
  }, [name]);

  if (nodeKeys.length === 0) {
    return (
      <div className="wl-page wl-apps">
        <Panel title="Apps" icon={Boxes}>
          <EmptyState compact title="No node to carry apps">
            Apps run on nodes, and none is paid to this address.{' '}
            <EntityLink kind="address" value={dto.address}>
              Open the address in the explorer
            </EntityLink>
            .
          </EmptyState>
        </Panel>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="wl-page wl-apps">
        <Panel title="Apps" icon={Boxes}>
          <EmptyState compact icon={Boxes} title="No app runs on these nodes">
            The network places apps on nodes by itself, and none has been placed on the{' '}
            {formatInt(nodeKeys.length)} {nodeKeys.length === 1 ? 'node' : 'nodes'} of this wallet. They
            appear here, with where they run, as soon as one is.
          </EmptyState>
        </Panel>
      </div>
    );
  }

  return (
    <div className="wl-page wl-apps">
      <Panel
        title="The fleet's apps"
        icon={Boxes}
        aside={`${formatInt(summary.apps)} ${summary.apps === 1 ? 'app' : 'apps'}, ${formatInt(summary.instances)} ${summary.instances === 1 ? 'instance' : 'instances'}`}
      >
        <Strip s={summary} />
      </Panel>

      <div className="wl-duo" data-lean="left">
        <Panel title="What runs on the fleet" aside="area is instances">
          <AppsTreemap apps={rows} selected={chosen?.name ?? null} onSelect={setSelected} />
        </Panel>
        {chosen ? (
          <AppDetail key={chosen.name} app={chosen} counts={counts} onClear={() => setSelected(null)} />
        ) : (
          <TopApps rows={rows} onSelect={setSelected} />
        )}
      </div>

      <div className="wl-duo" data-lean="left">
        <AppTable rows={rows} selected={chosen?.name ?? null} onSelect={setSelected} />
        <PerNode buckets={buckets} nodes={nodeKeys.length} />
      </div>
    </div>
  );
}
