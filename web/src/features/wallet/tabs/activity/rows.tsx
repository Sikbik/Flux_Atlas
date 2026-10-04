// A wallet's activity as timeline rows: the kit's Timeline draws the thread, the time gutter and the markers; this maps
// each kind of event to its icon and colour, and puts the node, its tier and (for a payment) what it is worth in the
// row's second line. The node's link pings it on the globe while the pointer or the focus is on it.

import {
  Activity,
  Ban,
  Boxes,
  Coins,
  Gauge,
  Info,
  LogOut,
  type LucideIcon,
  Network,
  OctagonX,
  Play,
  Rocket,
  ShieldAlert,
  Tag,
  TriangleAlert,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { shortCollateral } from '../../../../lib/format';
import { EntityLink, TierGlyph, type TimelineItem } from '../../../../ui';
import type { Money } from '../../hooks/useMoney';
import { type ActivityTone, paymentAmount, paymentTier, toneOfKind } from '../../lib/activity';
import type { FleetRow } from '../../lib/fleet';
import type { WalletActivity } from '../../types';

const ICONS: Record<string, LucideIcon> = {
  started: Play,
  confirmed: Rocket,
  paid: Coins,
  ip_changed: Network,
  at_risk: TriangleAlert,
  expired: OctagonX,
  left: LogOut,
  dos: ShieldAlert,
  collateral_spent: Ban,
  unreachable: WifiOff,
  recovered: Wifi,
  status: Activity,
  benchmark: Gauge,
  version: Tag,
  apps: Boxes,
};

const TONES: Record<ActivityTone, NonNullable<TimelineItem['tone']>> = {
  ok: 'ok',
  warn: 'warn',
  crit: 'crit',
  pay: 'accent',
  info: 'neutral',
};

const flux2 = (v: number): string =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface RowContext {
  /** The fleet by node key, for the endpoint and the tier. */
  rows: ReadonlyMap<string, FleetRow>;
  money: Money;
  /** Pings a node on the globe, or lets go with null. */
  hover: (row: FleetRow | null) => void;
}

interface NodeMetaProps {
  nodeKey: string | null;
  row: FleetRow | null;
  tier: FleetRow['tier'] | null;
  /** What a payment is worth, when it is known. */
  value: string | null;
  hover: RowContext['hover'];
}

function NodeMeta({ nodeKey, row, tier, value, hover }: NodeMetaProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the node pings on the globe while the pointer or the focus is on its link; the link is the control
    <span
      className="wl-evmeta"
      onPointerEnter={() => hover(row)}
      onPointerLeave={() => hover(null)}
      onFocus={() => hover(row)}
      onBlur={() => hover(null)}
    >
      {tier ? <TierGlyph tier={tier} size={12} /> : null}
      {nodeKey ? (
        <EntityLink kind="node" value={nodeKey} mono>
          {row?.endpoint || shortCollateral(nodeKey)}
        </EntityLink>
      ) : null}
      {value ? <span className="wl-evmeta__value">{value}</span> : null}
    </span>
  );
}

/** The timeline rows of the feed, in the order given. A payment reads as its amount, in two decimals, not eight. */
export function activityItems(list: readonly WalletActivity[], ctx: RowContext): TimelineItem[] {
  const seen = new Map<string, number>();
  return list.map((a) => {
    // Two rows of one node with the same kind at the same millisecond are possible; the key must stay unique.
    const base = `${a.t_ms}:${a.kind}:${a.node_key ?? ''}`;
    const dup = seen.get(base) ?? 0;
    seen.set(base, dup + 1);

    const row = a.node_key ? (ctx.rows.get(a.node_key) ?? null) : null;
    const paid = a.kind === 'paid';
    const amount = paid ? paymentAmount(a.detail) : null;
    const worth = amount !== null && ctx.money.price !== null ? ctx.money.text(amount) : null;
    const tier = (paid ? paymentTier(a.detail) : null) ?? row?.tier ?? null;

    return {
      id: dup === 0 ? base : `${base}#${dup}`,
      time: a.t_ms,
      title: amount === null ? a.detail : `Paid ${flux2(amount)} FLUX`,
      icon: ICONS[a.kind] ?? Info,
      tone: TONES[toneOfKind(a.kind, a.detail)],
      ...(a.height === null ? null : { block: a.height }),
      meta: <NodeMeta nodeKey={a.node_key} row={row} tier={tier} value={worth} hover={ctx.hover} />,
    };
  });
}
