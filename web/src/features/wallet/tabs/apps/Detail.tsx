// What is chosen in the picture or the table. With nothing chosen the panel lists the apps run most, which is also the
// picture's key (each bar has the colour of its block); with one chosen it says where that app runs: how many instances
// on how many nodes, which tiers carry it, and the nodes themselves, which ping on the globe under the pointer. From
// there the nodes go to the Fleet tab as a filtered table or onto the globe.

import { Boxes, Globe, ListFilter, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatInt, formatPercent, shortCollateral } from '../../../../lib/format';
import {
  BarList,
  type BarListItem,
  Button,
  EntityLink,
  ShareBar,
  type ShareSegment,
  TierGlyph,
} from '../../../../ui';
import { useWalletCtx } from '../../context';
import { showInFleet } from '../../hooks/useFleetView';
import { type AppRow, appColorSlot } from '../../lib/apps';
import type { FleetRow } from '../../lib/fleet';
import { PAY_TIERS } from '../../types';
import { Panel } from '../../ui/Panel';

/** The apps listed while none is chosen. */
const TOP = 10;
/** The chosen app's panel, which a narrow layout scrolls to when an app is chosen. */
export const DETAIL_ID = 'wl-app-detail';
/** The nodes listed until "Show all" is pressed. */
const SHOWN = 6;

const TIER_WORD = { cumulus: 'Cumulus', nimbus: 'Nimbus', stratus: 'Stratus' } as const;

const soonest = (a: FleetRow, b: FleetRow): number =>
  (a.etaMs ?? Number.POSITIVE_INFINITY) - (b.etaMs ?? Number.POSITIVE_INFINITY);

export interface TopAppsProps {
  /** Every app, the most run first. */
  rows: readonly AppRow[];
  onSelect: (name: string) => void;
}

/** The apps run most, with the colour each has in the picture. */
export function TopApps({ rows, onSelect }: TopAppsProps) {
  const items = useMemo<BarListItem[]>(
    () =>
      rows.slice(0, TOP).map((a) => ({
        id: a.name,
        label: a.label,
        title: `${a.label}: ${formatInt(a.instances)} ${a.instances === 1 ? 'instance' : 'instances'} on ${formatInt(a.nodes)} ${a.nodes === 1 ? 'node' : 'nodes'}`,
        value: a.instances,
        display: formatInt(a.instances),
        detail: formatPercent(a.share, 0),
        color: `var(--viz-${appColorSlot(a.name)})`,
        onSelect: () => onSelect(a.name),
      })),
    [rows, onSelect],
  );
  return (
    <Panel title="Run most" icon={Boxes} aside="choose one to see where it runs">
      <BarList label="The apps with the most instances" items={items} labelWidth="minmax(96px, 42%)" />
      {rows.length > TOP ? (
        <p className="wl-note">
          {formatInt(rows.length - TOP)} more {rows.length - TOP === 1 ? 'app is' : 'apps are'} in the table
          below.
        </p>
      ) : null}
    </Panel>
  );
}

export interface AppDetailProps {
  app: AppRow;
  /** How many different apps each node runs, to say what else a node carries. */
  counts: ReadonlyMap<string, number>;
  onClear: () => void;
}

function otherApps(n: number): string {
  if (n <= 0) return 'only this app';
  return `${formatInt(n)} other ${n === 1 ? 'app' : 'apps'}`;
}

/** One app: where it runs. */
export function AppDetail({ app, counts, onClear }: AppDetailProps) {
  const { fleet, addr, globe, setTab } = useWalletCtx();
  const [all, setAll] = useState(false);

  const members = useMemo(() => {
    const byKey = new Map(fleet.rows.map((r) => [r.key, r]));
    return app.keys.flatMap((k) => byKey.get(k) ?? []).sort(soonest);
  }, [fleet.rows, app.keys]);
  const shown = all ? members : members.slice(0, SHOWN);
  const onGlobe = globe.isShowing(members);

  const tiers = useMemo<ShareSegment[]>(
    () =>
      PAY_TIERS.map((t) => ({
        id: t,
        label: TIER_WORD[t],
        value: members.filter((m) => m.tier === t).length,
        tier: t,
      })),
    [members],
  );
  const tierWords = [...PAY_TIERS]
    .reverse()
    .map((t) => ({ t, n: members.filter((m) => m.tier === t).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${formatInt(x.n)} ${TIER_WORD[x.t]}`)
    .join(', ');

  return (
    <Panel
      id={DETAIL_ID}
      className="wl-adetail"
      title={app.label}
      icon={Boxes}
      actions={
        <Button size="sm" variant="ghost" icon={X} onClick={onClear} title="Back to the list of apps">
          All apps
        </Button>
      }
    >
      {app.label.toLowerCase() === app.name.toLowerCase() ? null : (
        <p className="wl-note">
          Registered as <span className="ui-mono">{app.name}</span>
        </p>
      )}
      <dl className="wl-facts">
        <div>
          <dt>Instances</dt>
          <dd className="ui-mono">{formatInt(app.instances)}</dd>
        </div>
        <div>
          <dt>Nodes</dt>
          <dd className="ui-mono">{formatInt(app.nodes)}</dd>
        </div>
        <div>
          <dt>Of all instances</dt>
          <dd className="ui-mono">{formatPercent(app.share, 1)}</dd>
        </div>
      </dl>

      {members.length > 0 ? (
        <div className="wl-amix">
          <ShareBar
            segments={tiers}
            legend="none"
            label={`Nodes running ${app.label} by tier`}
            format={(v) => formatInt(Math.round(v))}
          />
          <span className="wl-note">{tierWords}</span>
        </div>
      ) : null}

      {members.length > 0 ? (
        <ul className="wl-appnodes" aria-label={`Nodes running ${app.label}`}>
          {shown.map((r) => (
            <li
              key={r.key}
              onPointerEnter={() => globe.hover(r)}
              onPointerLeave={() => globe.hover(null)}
              onFocus={() => globe.hover(r)}
              onBlur={() => globe.hover(null)}
            >
              <TierGlyph tier={r.tier} size={14} />
              <EntityLink kind="node" value={r.key} mono className="wl-appnodes__link">
                {r.endpoint || shortCollateral(r.key)}
              </EntityLink>
              <span className="wl-appnodes__more">{otherApps((counts.get(r.key) ?? 1) - 1)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="wl-note">
          None of the nodes this app is listed on is in the fleet any longer, so there is nothing to show yet.
        </p>
      )}

      <div className="wl-appactions">
        {members.length > SHOWN ? (
          <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)} aria-expanded={all}>
            {all ? 'Show fewer' : `Show all ${formatInt(members.length)}`}
          </Button>
        ) : null}
        <Button
          size="sm"
          icon={ListFilter}
          disabled={members.length === 0}
          onClick={() => {
            showInFleet(addr, { only: { label: `Running ${app.label}`, keys: members.map((m) => m.key) } });
            setTab('fleet');
          }}
        >
          Show in the fleet table
        </Button>
        <Button
          size="sm"
          icon={Globe}
          aria-pressed={onGlobe}
          disabled={!globe.ready || members.length === 0}
          onClick={() => globe.showRows(members)}
        >
          {onGlobe ? 'On the globe' : 'Show on globe'}
        </Button>
        <EntityLink kind="app" value={app.name} className="wl-link">
          Open the app
        </EntityLink>
      </div>
    </Panel>
  );
}
