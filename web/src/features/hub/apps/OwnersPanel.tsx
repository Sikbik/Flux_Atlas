// The owners with the most apps running: each row is a ZelID with its apps, its instances against all of them, and
// what its instances lock. A row opens in place to show the owner's biggest apps, each a link. (The shell's operator
// window answers for node operators, and an app owner often runs no node, so a row does not lead there.)
//
// The sizes are the server's sum over apps with a public spec. An owner that also runs enterprise apps locks at least
// what is shown, marked with a plus, and one whose running instances are all enterprise has no figure at all, which
// reads Unknown and never 0. The list is the top 10 of the 25 the server ranks, with the rest a press away.

import { ChevronDown, ChevronRight, ChevronUp, UsersRound } from 'lucide-react';
import { type CSSProperties, useId, useMemo, useState } from 'react';
import type { AppIndexEntry } from '../../../api/generated/AppIndexEntry';
import type { AppsOverviewDto } from '../../../api/generated/AppsOverviewDto';
import { formatInt } from '../../../lib/format';
import { ShellLink } from '../../../shell/frame/ShellLink';
import { Button, CopyButton } from '../../../ui';
import type { Resource } from '../../analytics/lib/capacity';
import { shareText } from '../../analytics/lib/concentration';
import { HubPanel, type HubQuery, LbBar, type PanelState } from '..';
import { Ghost, WaitAside } from './ghost';
import { appsOfOwner, enterpriseByOwner, type IndexTotals } from './lib/apps';
import {
  lockedCell,
  lockedSentence,
  lockedWords,
  type OwnerRow,
  ownerRows,
  ownersSummary,
} from './lib/owners';
import { ghostOwners } from './lib/placeholders';
import { isWaiting, OwnerId, panelError } from './parts';
import './owners.css';

/** The rows shown before "Show all": a screen's worth. */
const FIRST = 10;

const FOOT_NOTE = 'Ranked by running instances. Sizes count apps with a public spec; a plus marks a floor.';

interface Column {
  id: string;
  header: string;
  width: string;
  align?: 'end';
  hide?: 'compact';
}

const COLUMNS: readonly Column[] = [
  { id: 'apps', header: 'Apps', width: '52px', align: 'end' },
  { id: 'instances', header: 'Instances', width: 'minmax(124px, 1.1fr)' },
  { id: 'cores', header: 'Cores', width: '64px', align: 'end', hide: 'compact' },
  { id: 'memory', header: 'Memory', width: '84px', align: 'end', hide: 'compact' },
  { id: 'storage', header: 'Storage', width: '88px', align: 'end', hide: 'compact' },
];

const TRACKS = ['2.25rem', 'minmax(0, 1.5fr)', ...COLUMNS.map((c) => c.width), '1rem'];
const COMPACT_TRACKS = [
  '2.25rem',
  'minmax(0, 1.5fr)',
  ...COLUMNS.filter((c) => !c.hide).map((c) => c.width),
  '1rem',
];
const GRID = {
  '--lb-cols': TRACKS.join(' '),
  '--lb-cols-compact': COMPACT_TRACKS.join(' '),
} as CSSProperties;

const RES: { key: Resource; pick: (r: OwnerRow) => OwnerRow['cores'] }[] = [
  { key: 'cpu', pick: (r) => r.cores },
  { key: 'ram', pick: (r) => r.ramGb },
  { key: 'ssd', pick: (r) => r.ssdGb },
];

function Locked({ row, res }: { row: OwnerRow; res: (typeof RES)[number] }) {
  const l = res.pick(row);
  return (
    <span className="ap-num" data-unknown={l.kind === 'unknown' || undefined}>
      <span className="ui-sr-only">{lockedWords(l, res.key)}</span>
      <span aria-hidden="true">{lockedCell(l, res.key)}</span>
    </span>
  );
}

function OwnerOpen({
  id,
  row,
  apps,
  network,
}: {
  id: string;
  row: OwnerRow;
  apps: readonly AppIndexEntry[] | undefined;
  network: AppsOverviewDto['resources']['network'] | null;
}) {
  const mine = useMemo(
    () => (apps ? appsOfOwner(apps, row.owner, 8, network) : null),
    [apps, row.owner, network],
  );
  return (
    <div id={id} className="ap-owner__open">
      <p className="ap-owner__id">
        <span className="ap-dim">Owner</span>
        <code className="ap-id">{row.owner}</code>
        <CopyButton value={row.owner} what="owner ID" />
      </p>
      {mine ? (
        <div className="ap-owner__apps-wrap">
          <p className="ap-owner__cap" aria-hidden="true">
            Biggest apps, by running instances
          </p>
          <ul className="ap-owner__apps" aria-label="The owner's biggest apps, with their running instances">
            {mine.top.map((a) => (
              <li key={a.name}>
                <ShellLink
                  to={{ type: 'app', key: a.name }}
                  className="ap-chip"
                  title={`${a.label}: ${formatInt(a.instances)} running ${a.instances === 1 ? 'instance' : 'instances'}`}
                >
                  <span className="ap-chip__name">{a.label}</span>
                  <span className="ap-chip__n ap-num">{formatInt(a.instances)}</span>
                </ShellLink>
              </li>
            ))}
            {mine.more > 0 ? (
              <li className="ap-owner__more ap-dim">and {formatInt(mine.more)} more</li>
            ) : null}
          </ul>
        </div>
      ) : (
        <p className="ap-note">The apps of this owner come with the app list, which is not loaded yet.</p>
      )}
      <p className="ap-note">{lockedSentence(row)}</p>
    </div>
  );
}

function OwnerItem({
  row,
  n,
  max,
  open,
  onToggle,
  apps,
  network,
}: {
  row: OwnerRow;
  n: number;
  max: number;
  open: boolean;
  onToggle: () => void;
  apps: readonly AppIndexEntry[] | undefined;
  network: AppsOverviewDto['resources']['network'] | null;
}) {
  const panelId = useId();
  const sub =
    row.enterpriseApps !== null && row.enterpriseApps > 0
      ? `${formatInt(row.enterpriseApps)} enterprise`
      : null;
  return (
    <li className="ap-owner" data-open={open || undefined}>
      <div className="hub-lb__row" data-top={n <= 3 ? n : undefined}>
        <span className="hub-lb__rank" aria-hidden="true">
          {n}
        </span>
        <span className="hub-lb__who">
          <button
            type="button"
            className="hub-lb__link ap-owner__toggle"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-label={`${n}. Owner ${row.owner}: ${formatInt(row.apps)} ${row.apps === 1 ? 'app' : 'apps'}, ${formatInt(row.instances)} ${row.instances === 1 ? 'instance' : 'instances'}`}
            onClick={onToggle}
          >
            <OwnerId id={row.owner} />
          </button>
          {sub ? <span className="hub-lb__sub">{sub}</span> : null}
        </span>
        <span className="hub-lb__cells">
          <span className="hub-lb__cell" data-col="apps" data-align="end">
            <span className="ui-sr-only">Apps: </span>
            <span className="ap-num">{formatInt(row.apps)}</span>
            <span className="ap-unit" aria-hidden="true">
              {row.apps === 1 ? ' app' : ' apps'}
            </span>
          </span>
          <span className="hub-lb__cell" data-col="instances">
            <span className="ui-sr-only">Instances: </span>
            <LbBar
              value={row.instances}
              max={max}
              text={
                <>
                  <span>{formatInt(row.instances)}</span>
                  <span className="ap-unit" aria-hidden="true">
                    {row.instances === 1 ? ' instance' : ' instances'}
                  </span>
                  {row.share !== null ? <span className="ap-dim"> {shareText(row.share)}</span> : null}
                </>
              }
            />
          </span>
          {RES.map((res, i) => (
            <span
              key={res.key}
              className="hub-lb__cell"
              data-col={COLUMNS[i + 2]?.id}
              data-hide="compact"
              data-align="end"
            >
              <span className="ui-sr-only">{COLUMNS[i + 2]?.header}: </span>
              <Locked row={row} res={res} />
            </span>
          ))}
        </span>
        <span className="hub-lb__acts">
          <ChevronRight className="ap-owner__chev" size={16} strokeWidth={1.5} aria-hidden="true" />
        </span>
      </div>
      {open ? <OwnerOpen id={panelId} row={row} apps={apps} network={network} /> : null}
    </li>
  );
}

/** The rows the table of a loading panel is made of: ten owners, as the live network has. */
const GHOST = ghostOwners(FIRST);
const NOTHING_OPEN: ReadonlySet<string> = new Set();
const NO_OP = () => undefined;

interface OwnersTableProps {
  shown: readonly OwnerRow[];
  /** The sentence for a screen reader, ahead of the list. */
  summary: string | null;
  max: number;
  openIds: ReadonlySet<string>;
  onToggle: (owner: string) => void;
  apps: readonly AppIndexEntry[] | undefined;
  network: AppsOverviewDto['resources']['network'] | null;
}

/** The leaderboard: its column heads and its rows. The loading state draws it too, from made-up rows. */
function OwnersTable({ shown, summary, max, openIds, onToggle, apps, network }: OwnersTableProps) {
  return (
    <div className="hub-lb ap-owners" style={GRID}>
      {summary ? <p className="ui-sr-only">{summary}</p> : null}
      <div className="hub-lb__head" aria-hidden="true" data-static>
        <span />
        <span />
        {COLUMNS.map((c) => (
          <span key={c.id} data-hide={c.hide} data-align={c.align}>
            {c.header}
          </span>
        ))}
        <span />
      </div>
      <ol className="hub-lb__list ap-owners__list" aria-label="Top app owners">
        {shown.map((r, i) => (
          <OwnerItem
            key={r.owner}
            row={r}
            n={i + 1}
            max={max}
            open={openIds.has(r.owner)}
            onToggle={() => onToggle(r.owner)}
            apps={apps}
            network={network}
          />
        ))}
      </ol>
    </div>
  );
}

export interface OwnersPanelProps {
  overview: HubQuery<AppsOverviewDto>;
  /** The app index, for the part of an owner's size that is private and for the owner's apps. */
  apps: readonly AppIndexEntry[] | undefined;
  totals: IndexTotals | null;
}

export function OwnersPanel({ overview, apps, totals }: OwnersPanelProps) {
  const o = overview.data;
  const [all, setAll] = useState(false);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set());
  const enterprise = useMemo(() => (apps ? enterpriseByOwner(apps) : null), [apps]);
  const rows = useMemo(
    () => (o ? ownerRows(o.owners, enterprise, o.enterprise.apps > 0, totals ? totals.instances : null) : []),
    [o, enterprise, totals],
  );
  const network = o ? o.resources.network : null;
  const shown = all ? rows : rows.slice(0, FIRST);
  const max = rows.reduce((m, r) => Math.max(m, r.instances), 0);
  const toggle = (owner: string) =>
    setOpenIds((cur) => {
      const next = new Set(cur);
      if (!next.delete(owner)) next.add(owner);
      return next;
    });

  // Loading is the ready state with made-up rows, so the footer is there and the panel does not grow when they arrive.
  const loading = !o && overview.isPending;
  const state: PanelState = o ? (o.owners.length === 0 ? 'empty' : 'ready') : loading ? 'ready' : 'error';

  return (
    <HubPanel
      id="owners"
      span="twothirds"
      title="Top owners"
      icon={UsersRound}
      aside={
        o && o.owners.length > 0 ? (
          `${formatInt(o.total_owners)} owners in the index`
        ) : isWaiting(overview) ? (
          <WaitAside what="The owners" />
        ) : undefined
      }
      state={state}
      aria-busy={loading || undefined}
      error={overview.error}
      onRetry={() => void overview.refetch()}
      retrying={overview.isFetching}
      {...panelError(overview.error, 'the owners')}
      emptyIcon={UsersRound}
      emptyTitle="No owners yet"
      emptyText="The server has no app in its index."
      flush
      footer={
        loading ? (
          <>
            <Ghost>
              <Button size="sm" variant="ghost" icon={ChevronDown}>
                Show all 25
              </Button>
            </Ghost>
            <span className="ap-foot-note">{FOOT_NOTE}</span>
          </>
        ) : o && rows.length > 0 ? (
          <>
            {rows.length > FIRST ? (
              <Button
                size="sm"
                variant="ghost"
                icon={all ? ChevronUp : ChevronDown}
                aria-expanded={all}
                onClick={() => setAll((v) => !v)}
              >
                {all ? 'Show fewer' : `Show all ${formatInt(rows.length)}`}
              </Button>
            ) : (
              <span />
            )}
            <span className="ap-foot-note">{FOOT_NOTE}</span>
          </>
        ) : undefined
      }
    >
      {loading ? (
        <Ghost>
          <OwnersTable
            shown={GHOST}
            summary={null}
            max={GHOST[0]?.instances ?? 1}
            openIds={NOTHING_OPEN}
            onToggle={NO_OP}
            apps={undefined}
            network={null}
          />
        </Ghost>
      ) : o ? (
        <OwnersTable
          shown={shown}
          summary={ownersSummary(rows, shown.length, o.total_owners)}
          max={max}
          openIds={openIds}
          onToggle={toggle}
          apps={apps}
          network={network}
        />
      ) : null}
    </HubPanel>
  );
}
