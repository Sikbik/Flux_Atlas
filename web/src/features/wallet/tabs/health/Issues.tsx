// What needs a look: one card per kind of finding, worst first, each saying what it means for the money and what to do
// about it, with the nodes it touches. A card opens on its nodes, which ping on the globe under the pointer; from a card
// the nodes go to the Fleet tab as a filtered table or onto the globe. Nothing here is a verdict about the wallet: the
// server decides what is wrong, this explains it.

import { ChevronDown, CircleCheck, CircleX, Globe, Info, ListFilter, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatInt, shortCollateral } from '../../../../lib/format';
import { Button, Chip, EmptyState, EntityLink, StatusChip, TierGlyph } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { showInFleet } from '../../hooks/useFleetView';
import type { FleetRow } from '../../lib/fleet';
import { type IssueGroup, SEVERITY_WORD, type Severity } from '../../lib/health';
import { Panel } from '../../ui/Panel';

/** A card lists this many nodes until "Show all" is pressed. */
const SHOWN = 6;

const ICON = { crit: CircleX, warn: TriangleAlert, info: Info } as const;

function SeverityChip({ severity }: { severity: Severity }) {
  if (severity === 'crit') return <StatusChip status="error" label={SEVERITY_WORD.crit} size="sm" />;
  if (severity === 'warn') return <StatusChip status="at-risk" label={SEVERITY_WORD.warn} size="sm" />;
  return (
    <Chip size="sm" icon={Info}>
      {SEVERITY_WORD.info}
    </Chip>
  );
}

function IssueCard({ g, rows }: { g: IssueGroup; rows: ReadonlyMap<string, FleetRow> }) {
  const { addr, globe, setTab } = useWalletCtx();
  const [all, setAll] = useState(false);
  const Icon = ICON[g.severity];
  const shown = all ? g.nodes : g.nodes.slice(0, SHOWN);
  const members = useMemo(() => g.nodes.flatMap((n) => rows.get(n.key) ?? []), [g.nodes, rows]);
  const onGlobe = globe.isShowing(members);

  return (
    <details className="wl-issue" data-severity={g.severity} open={g.severity === 'crit'}>
      <summary className="wl-issue__head">
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" className="wl-issue__icon" />
        <span className="wl-issue__title">{g.title}</span>
        <SeverityChip severity={g.severity} />
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" className="wl-issue__chev" />
      </summary>
      <div className="wl-issue__body">
        <div className="wl-issue__texts">
          <p className="wl-issue__text">
            <b>Why it matters</b>
            {g.why}
          </p>
          <p className="wl-issue__text">
            <b>What to do</b>
            {g.fix}
          </p>
        </div>
        <ul className="wl-issue__nodes" aria-label={`The ${formatInt(g.nodes.length)} nodes: ${g.title}`}>
          {shown.map((n) => {
            const row = rows.get(n.key) ?? null;
            return (
              <li
                key={n.key}
                onPointerEnter={() => globe.hover(row)}
                onPointerLeave={() => globe.hover(null)}
                onFocus={() => globe.hover(row)}
                onBlur={() => globe.hover(null)}
              >
                <TierGlyph tier={row?.tier ?? 'unknown'} size={14} />
                <EntityLink kind="node" value={n.key} mono className="wl-issue__node">
                  {row?.endpoint || shortCollateral(n.key)}
                </EntityLink>
                <span className="wl-issue__detail">{n.detail}</span>
              </li>
            );
          })}
        </ul>
        <div className="wl-issue__actions">
          {g.nodes.length > SHOWN ? (
            <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)} aria-expanded={all}>
              {all ? 'Show fewer' : `Show all ${formatInt(g.nodes.length)}`}
            </Button>
          ) : null}
          <Button
            size="sm"
            icon={ListFilter}
            onClick={() => {
              showInFleet(addr, { only: { label: g.title, keys: g.nodes.map((n) => n.key) } });
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
        </div>
      </div>
    </details>
  );
}

export interface IssuesProps {
  groups: readonly IssueGroup[];
}

export function Issues({ groups }: IssuesProps) {
  const { fleet } = useWalletCtx();
  const rows = useMemo(() => new Map(fleet.rows.map((r) => [r.key, r])), [fleet.rows]);

  if (groups.length === 0) {
    return (
      <Panel title="What needs a look">
        <EmptyState compact icon={CircleCheck} title="Nothing needs a look">
          Every node of this wallet is confirmed and clears what its tier asks of it. Atlas checks this each
          time the wallet is fetched, and it will say here when that changes.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel
      title="What needs a look"
      aside={`${formatInt(groups.length)} ${groups.length === 1 ? 'kind of finding' : 'kinds of finding'}, worst first`}
    >
      <div className="wl-issues-list">
        {groups.map((g) => (
          <IssueCard key={g.id} g={g} rows={rows} />
        ))}
      </div>
    </Panel>
  );
}
