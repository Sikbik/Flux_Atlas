// Small pieces several explorer views share: node references resolved from the live store, address
// labels, and the glyph tile of a transaction kind.

import {
  ArrowLeftRight,
  Boxes,
  CircleHelp,
  Coins,
  HeartPulse,
  type LucideIcon,
  Power,
  Server,
  ShieldCheck,
} from 'lucide-react';
import type { TxKind } from '../../../api/generated/TxKind';
import { useNetwork } from '../../../app/context';
import { shallowEqual } from '../../../store/react';
import { knownEntity } from '../lib/entities';
import { cx, TierGlyph, type TierName } from '../parts';
import './shared.css';
import { EntityLink } from '../parts/identity';

const TIERS = ['unknown', 'cumulus', 'nimbus', 'stratus'] as const;

export interface NodeInfo {
  endpoint: string;
  tier: TierName | 'unknown';
  cc: string;
}

/** A node's endpoint, tier and country from the live node table (null when the id is not listed). */
export function useNodeInfo(id: number | null | undefined): NodeInfo | null {
  const t = useNetwork(
    (s) => {
      if (id === null || id === undefined) return null;
      const i = s.nodes.indexOf(id);
      if (i < 0) return null;
      return [s.nodes.endpoint(i), s.nodes.tier[i] ?? 0, s.nodes.countryCode(i)] as const;
    },
    (a, b) =>
      a === b || (a !== null && b !== null && shallowEqual(a as readonly unknown[], b as readonly unknown[])),
  );
  if (!t) return null;
  return { endpoint: t[0], tier: TIERS[t[1]] ?? 'unknown', cc: t[2] };
}

/** A node as a link: tier glyph, then `ip:port` (or the id when the node is not in the table). */
export function NodeLink({
  id,
  fallbackEndpoint,
  fallbackTier,
  glyph = true,
}: {
  id: number | null | undefined;
  fallbackEndpoint?: string | null;
  fallbackTier?: string | null;
  glyph?: boolean;
}) {
  const info = useNodeInfo(id);
  const endpoint = info?.endpoint || fallbackEndpoint || null;
  const tier = (info?.tier ?? (fallbackTier as TierName | null) ?? 'unknown') as TierName | 'unknown';
  const key = endpoint || (id !== null && id !== undefined ? String(id) : null);
  if (!key) return <span className="ex-unknown">Unknown node</span>;
  return (
    <span className="ex-nodelink" data-tier={tier === 'unknown' ? undefined : tier}>
      {glyph ? <TierGlyph tier={tier} size={14} /> : null}
      <EntityLink kind="node" value={key}>
        {endpoint ?? `Node ${id}`}
      </EntityLink>
    </span>
  );
}

/** An address as a link with its known label, when it has one ("Dev fund"). */
export function AddressTag({
  address,
  full,
  className,
  hideLabel,
}: {
  address: string | null | undefined;
  full?: boolean;
  className?: string;
  /** Skip the known-entity chip when the surrounding text already says what it is. */
  hideLabel?: boolean;
}) {
  if (!address) return <span className="ex-unknown">Unknown</span>;
  const k = knownEntity(address);
  return (
    <span className={cx('ex-addrtag', className)} data-entity={k?.kind}>
      <EntityLink kind="address" value={address}>
        {full ? address : undefined}
      </EntityLink>
      {k && !hideLabel ? (
        <span className="ex-addrtag__label" title={k.note}>
          {k.label}
        </span>
      ) : null}
    </span>
  );
}

const KIND_ICON: Record<TxKind, LucideIcon> = {
  coinbase: Coins,
  transfer: ArrowLeftRight,
  app_message: Boxes,
  node_start: Power,
  node_confirm: ShieldCheck,
  node_tx: Server,
  unknown: CircleHelp,
};

/** The square glyph tile that stands for a transaction kind. */
export function KindTile({ kind, pulse }: { kind: TxKind | 'heartbeat'; pulse?: boolean }) {
  const Icon = kind === 'heartbeat' ? HeartPulse : KIND_ICON[kind];
  return (
    <span className="ex-kindtile" data-kind={kind} data-pulse={pulse || undefined} aria-hidden="true">
      <Icon size={15} strokeWidth={1.5} />
    </span>
  );
}
