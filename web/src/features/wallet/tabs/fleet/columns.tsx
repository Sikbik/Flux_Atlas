// The fleet table's cells: what each column of a node's row shows. Each is a small component or a plain value, and the
// columns are built once per set of chosen columns, so a row re-renders only when its own node changes.

import { TriangleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTip } from '../../../../app/context';
import { formatBytes, formatInt, shortCollateral } from '../../../../lib/format';
import { type DataTableColumn, StatusChip, TierGlyph, Tooltip, tierLabel } from '../../../../ui';
import { BASIS_PHRASE, basisOf, earnedOrNull } from '../../../earnings/basis';
import { CHECKIN, expiryState } from '../../../inspect/derive/expiry';
import { blocksLong, blocksText, COLUMN_SPECS, type ColumnId, type FleetRow } from '../../lib/fleet';
import { reasonLabel, variantOf } from '../../lib/health';
import type { HealthReason, NodeAttention } from '../../types';
import { Eta } from '../../ui/Eta';

/** The server's findings by node: the state cell lists them, the version cell reads whether FluxOS is behind. */
export type AttentionMap = ReadonlyMap<string, NodeAttention>;

function NodeCell({ r }: { r: FleetRow }) {
  const tier = r.tier === 'unknown' ? undefined : r.tier;
  return (
    <span className="wl-nodecell" data-gone={!r.present || undefined}>
      <TierGlyph tier={r.tier} size={14} />
      {tier ? <span className="ui-sr-only">{tierLabel(tier)}, </span> : null}
      <span className="wl-nodecell__ep">{r.endpoint || shortCollateral(r.key)}</span>
    </span>
  );
}

function Reasons({ reasons }: { reasons: readonly HealthReason[] }) {
  return (
    <ul className="wl-reasons">
      {reasons.map((x, i) => (
        // A node can carry two reasons of one kind (two metrics): the position is the only difference.
        // biome-ignore lint/suspicious/noArrayIndexKey: a short list that never reorders
        <li key={`${x.kind}:${i}`}>
          <b>{reasonLabel(x)}</b>
          {x.detail ? <span>{x.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function StateCell({ r, reasons }: { r: FleetRow; reasons: readonly HealthReason[] }) {
  return (
    <span className="wl-statecell">
      <StatusChip status={r.statusKind} size="sm" />
      {reasons.length > 0 ? (
        <Tooltip content={<Reasons reasons={reasons} />} placement="bottom">
          <span className="wl-issuecount" data-severity={r.severity ?? undefined}>
            <TriangleAlert size={12} strokeWidth={1.5} aria-hidden="true" />
            <span aria-hidden="true">{reasons.length}</span>
            <span className="ui-sr-only">
              {reasons.length === 1 ? '1 finding: ' : `${reasons.length} findings: `}
              {reasons.map(reasonLabel).join(', ')}
            </span>
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

function PayoutCell({ r }: { r: FleetRow }) {
  if (r.etaMs === null) return <span className="wl-muted">Not queued</span>;
  return (
    <span className="wl-paycell">
      <Eta at={r.etaMs} className="wl-paycell__eta ui-mono" />
      {r.amount !== null ? <i className="ui-mono">+{r.amount.toFixed(2)}</i> : null}
    </span>
  );
}

function PaidCell({ height }: { height: number | null }) {
  const tip = useTip()?.height ?? null;
  if (height === null) return <span className="wl-muted">Not yet</span>;
  if (tip === null) return <span className="ui-mono">{formatInt(height)}</span>;
  const blocks = Math.max(0, tip - height);
  const text = blocksText(blocks);
  return (
    <span title={`Block ${formatInt(height)}, ${blocksLong(blocks)} ago`}>
      {text === 'now' ? 'just now' : `${text} ago`}
    </span>
  );
}

function AgeCell({ added }: { added: number | null }) {
  const tip = useTip()?.height ?? null;
  if (added === null || added <= 0 || tip === null) return null;
  const blocks = Math.max(0, tip - added);
  return <span title={`Since block ${formatInt(added)}, ${blocksLong(blocks)}`}>{blocksText(blocks)}</span>;
}

function CheckinCell({ since }: { since: number | null }) {
  if (since === null) return null;
  const state = expiryState(since);
  return (
    <span className="wl-checkin" data-state={state}>
      <span className="ui-mono">{formatInt(since)}</span>
      <i
        className="wl-checkin__bar"
        style={{ '--wl-fill': Math.min(1, since / CHECKIN.expire) } as CSSProperties}
        aria-hidden="true"
      />
    </span>
  );
}

function VersionCell({ r, reasons }: { r: FleetRow; reasons: readonly HealthReason[] }) {
  if (!r.version) return null;
  const behind = reasons.some((x) => x.kind === 'version_outdated' && variantOf(x) === 'flux_os');
  return (
    <span className="wl-version" data-behind={behind || undefined}>
      <span className="ui-mono">{r.version}</span>
      {behind ? <i>behind</i> : null}
    </span>
  );
}

const NO_REASONS: readonly HealthReason[] = [];

type Cell = Pick<DataTableColumn<FleetRow>, 'cell' | 'value' | 'width' | 'minWidth' | 'mono' | 'title'>;

/** How each column draws its cell; the headers, sorting and alignment come from the column specs. */
function cells(attention: AttentionMap, includePa: boolean): Record<ColumnId, Cell> {
  const reasonsOf = (r: FleetRow) => attention.get(r.key)?.reasons ?? NO_REASONS;
  return {
    node: { cell: (r) => <NodeCell r={r} />, width: '1.7fr', minWidth: 196, mono: true },
    state: { cell: (r) => <StateCell r={r} reasons={reasonsOf(r)} />, width: '1.7fr', minWidth: 176 },
    payout: { cell: (r) => <PayoutCell r={r} />, minWidth: 120 },
    place: { cell: (r) => (r.place === null ? null : `#${formatInt(r.place)}`), minWidth: 84 },
    paid: { cell: (r) => <PaidCell height={r.lastPaidHeight} />, minWidth: 104 },
    checkin: {
      cell: (r) => <CheckinCell since={r.sinceConfirm} />,
      minWidth: 120,
      title: 'Blocks since the last check-in. A node must check in within 640 blocks or it expires.',
    },
    perDay: {
      cell: (r) => {
        const v = earnedOrNull(r.perDay, r.paPerDay, includePa);
        return v === null ? null : v.toFixed(2);
      },
      minWidth: 96,
      title: `FLUX a day at today's queue lengths, ${BASIS_PHRASE[basisOf(includePa)]}`,
    },
    country: { cell: (r) => r.country || null, width: '1.1fr', minWidth: 132 },
    city: { cell: (r) => r.city || null, minWidth: 112 },
    provider: { cell: (r) => r.provider || null, width: '1.2fr', minWidth: 140 },
    version: { cell: (r) => <VersionCell r={r} reasons={reasonsOf(r)} />, minWidth: 112 },
    cores: { value: (r) => r.cores || null, minWidth: 72 },
    ram: { cell: (r) => (r.ramGb ? formatBytes(r.ramGb * 1e9) : null), minWidth: 84 },
    ssd: { cell: (r) => (r.ssdGb ? formatBytes(r.ssdGb * 1e9) : null), minWidth: 84 },
    apps: { value: (r) => r.appCount, minWidth: 72 },
    age: {
      cell: (r) => <AgeCell added={r.addedHeight} />,
      minWidth: 84,
      title: 'How long ago the node was added',
    },
  };
}

/** The table's columns for the chosen ids, in the table's own order. Build once per choice (memoise it). */
export function buildColumns(
  ids: readonly ColumnId[],
  attention: AttentionMap,
  includePa: boolean,
): DataTableColumn<FleetRow>[] {
  const draw = cells(attention, includePa);
  const want = new Set<ColumnId>(ids);
  return COLUMN_SPECS.filter((c) => want.has(c.id)).map((c) => ({
    id: c.id,
    header: c.short ?? c.label,
    title: c.short ? c.label : undefined,
    sortable: true,
    numeric: c.numeric,
    defaultSortDir: c.firstDir,
    ...draw[c.id],
  }));
}
