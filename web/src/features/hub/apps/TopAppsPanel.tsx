// The biggest apps, two ways: by the instances running and by the share of the network's capacity they hold (their
// footprint). A picture (a treemap) for the pointer and a ranked list for the keyboard and the screen reader, tied
// together: pointing at a row lights its cell and the other way round. Every app in either is a real link to its window.
//
// The footprint needs the network's capacity, which comes with the overview; until then the control keeps to
// instances. An enterprise app has instances but a private size, so it ranks by instances and is left out of the
// footprint ranking, and the picture says how many were left out.

import { Lock, Rows3 } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import type { AppsIndexDto } from '../../../api/generated/AppsIndexDto';
import type { AppsOverviewDto } from '../../../api/generated/AppsOverviewDto';
import { formatInt, formatPercent } from '../../../lib/format';
import { ShellLink } from '../../../shell/frame/ShellLink';
import { SegmentedControl, ShareBar } from '../../../ui';
import { appColorSlot } from '../../wallet/lib/apps';
import { HubPanel, type HubQuery, type PanelState } from '..';
import { AppsMap } from './AppsMap';
import { Ghost } from './ghost';
import { type AppRank, type IndexTotals, privateRunning, type RankBy, rankApps } from './lib/apps';
import { GHOST_MAP_CAPTION, ghostRanked } from './lib/placeholders';
import { lockedText, valueText } from './lib/treemap';
import { panelError } from './parts';
import './top.css';

/** The ranked list names this many apps; the picture shows more, by pointer. */
const LIST_ROWS = 10;

const OPTIONS = [
  { value: 'instances', label: 'Instances' },
  { value: 'footprint', label: 'Footprint' },
] as const;

function Row({
  r,
  n,
  by,
  totalInstances,
  hot,
  onHot,
}: {
  r: AppRank;
  n: number;
  by: RankBy;
  totalInstances: number;
  hot: string | null;
  onHot: (name: string | null) => void;
}) {
  const value = valueText(r, by);
  const sub =
    by === 'instances'
      ? totalInstances > 0
        ? `${formatPercent(r.instances / totalInstances, 1)} of all instances`
        : ''
      : (lockedText(r) ?? '');
  return (
    <li className="ap-rank__row" data-hot={hot === r.name || undefined}>
      <span className="ap-rank__n" aria-hidden="true">
        {n}
      </span>
      <span className="ap-rank__who">
        <ShellLink
          to={{ type: 'app', key: r.name }}
          className="ap-rank__link"
          aria-label={`${n}. ${r.label}, ${value}${by === 'instances' ? (r.instances === 1 ? ' instance' : ' instances') : ' of the network'}`}
          onPointerEnter={() => onHot(r.name)}
          onPointerLeave={() => onHot(null)}
          onFocus={() => onHot(r.name)}
          onBlur={() => onHot(null)}
        >
          <i
            className="ap-rank__dot"
            style={{ '--ap-c': `var(--viz-${appColorSlot(r.name)})` } as CSSProperties}
            aria-hidden="true"
          />
          <span className="ap-rank__name">{r.label}</span>
        </ShellLink>
        {r.enterprise ? (
          <Lock
            className="ap-rank__lock"
            size={12}
            strokeWidth={1.5}
            aria-label="Enterprise app: its size is private"
          />
        ) : null}
      </span>
      <span className="ap-rank__val ap-num">{value}</span>
      <span className="ap-rank__sub">{sub}</span>
    </li>
  );
}

/** The ranked list of a loading panel: ten made-up apps, as the list names. */
const GHOST_RANKED = ghostRanked(LIST_ROWS);
const GHOST_INSTANCES = 8_400;
const GHOST_ASIDE = `${formatInt(1_900)} in the index`;
const NO_OP = () => undefined;

/**
 * What the panel looks like before the index is in: the picture as one field of its size, the bar under it and its
 * sentence, and the list's real rows with made-up apps. It has the size of the loaded panel at every width.
 */
function TopAppsGhost() {
  return (
    <Ghost>
      <div className="ap-top">
        <figure className="ap-treefig">
          <div className="ap-tree" />
          <ShareBar
            className="ap-treefig__tail"
            label="Instances held, biggest apps and the rest"
            show="both"
            format={formatInt}
            segments={[
              { id: 'drawn', label: 'The 30 biggest', value: 7_100, color: 'var(--viz-1)' },
              { id: 'rest', label: '1,870 smaller apps', value: 1_300, color: 'var(--viz-other)' },
            ]}
          />
          <figcaption className="ap-note ap-treefig__cap">{GHOST_MAP_CAPTION}</figcaption>
        </figure>
        <div className="ap-rank">
          <h3 className="ap-rank__h" data-static>
            Most instances
          </h3>
          <ol className="ap-rank__list">
            {GHOST_RANKED.map((r, i) => (
              <Row
                key={r.name}
                r={r}
                n={i + 1}
                by="instances"
                totalInstances={GHOST_INSTANCES}
                hot={null}
                onHot={NO_OP}
              />
            ))}
          </ol>
        </div>
      </div>
    </Ghost>
  );
}

export interface TopAppsPanelProps {
  index: HubQuery<AppsIndexDto>;
  overview: HubQuery<AppsOverviewDto>;
  totals: IndexTotals | null;
}

export function TopAppsPanel({ index, overview, totals }: TopAppsPanelProps) {
  const [chosen, setChosen] = useState<RankBy>('instances');
  const [hot, setHot] = useState<string | null>(null);
  const apps = index.data?.apps;
  const network = overview.data ? overview.data.resources.network : null;
  const known = !!network && network.cores > 0 && network.ram_gb > 0 && network.ssd_gb > 0;
  // The footprint is shown only once the network's capacity is: until then the control keeps to instances.
  const by: RankBy = chosen === 'footprint' && known ? 'footprint' : 'instances';

  const ranked = useMemo(() => (apps ? rankApps(apps, by, network) : []), [apps, by, network]);
  const leftOut = useMemo(() => (apps ? privateRunning(apps) : 0), [apps]);
  const listed = ranked.slice(0, LIST_ROWS);
  const total = totals ? totals.instances : 0;

  // Loading is the ready state with made-up apps, so the panel does not grow when the index arrives.
  const loading = !apps && index.isPending;
  const state: PanelState = apps
    ? ranked.length === 0 && by === 'instances'
      ? 'empty'
      : 'ready'
    : loading
      ? 'ready'
      : 'error';

  return (
    <HubPanel
      id="top-apps"
      span="full"
      title="Top apps"
      icon={Rows3}
      aside={
        totals ? (
          `${formatInt(totals.apps)} in the index`
        ) : loading ? (
          <Ghost as="span">{GHOST_ASIDE}</Ghost>
        ) : undefined
      }
      actions={
        <SegmentedControl
          size="sm"
          aria-label="Rank apps by"
          options={OPTIONS.map((o) => ({ ...o, disabled: o.value === 'footprint' && !known }))}
          value={by}
          onChange={setChosen}
        />
      }
      state={state}
      aria-busy={loading || undefined}
      error={index.error}
      onRetry={() => void index.refetch()}
      retrying={index.isFetching}
      {...panelError(index.error, 'the apps')}
      emptyIcon={Rows3}
      emptyTitle="No app is running yet"
      emptyText="The index has no app with an instance running."
    >
      {loading ? (
        <TopAppsGhost />
      ) : (
        <div className="ap-top">
          <AppsMap
            ranked={ranked}
            by={by}
            totalInstances={total}
            leftOut={leftOut}
            hot={hot}
            onHot={setHot}
          />
          <div className="ap-rank">
            <h3 className="ap-rank__h" data-static>
              {by === 'instances' ? 'Most instances' : 'Largest footprint'}
            </h3>
            {listed.length > 0 ? (
              <ol className="ap-rank__list" aria-label={`Top ${listed.length} apps by ${by}`}>
                {listed.map((r, i) => (
                  <Row key={r.name} r={r} n={i + 1} by={by} totalInstances={total} hot={hot} onHot={setHot} />
                ))}
              </ol>
            ) : (
              <p className="ap-note">No app has a known footprint yet.</p>
            )}
          </div>
        </div>
      )}
    </HubPanel>
  );
}
