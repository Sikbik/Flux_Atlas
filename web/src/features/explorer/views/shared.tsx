// Small pieces several explorer views share: node references resolved from the live store, address
// labels, and the glyph tile of a transaction kind. Built from the kit; what is here is only what needs
// the live store or this feature's knowledge of entities.

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
import { Chip, cx, EntityLink, TierGlyph, type TierName, Unknown } from '../../../ui';
import { knownEntity } from '../lib/entities';
import './shared.css';

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
  if (!key) return <Unknown>Unknown node</Unknown>;
  return (
    <span className="ex-nodelink">
      {glyph ? <TierGlyph tier={tier} size={14} /> : null}
      <EntityLink kind="node" value={key} mono>
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
  if (!address) return <Unknown />;
  const k = knownEntity(address);
  return (
    <span className={cx('ex-addrtag', className)} data-entity={k?.kind}>
      <EntityLink kind="address" value={address} mono={full || undefined}>
        {full ? address : undefined}
      </EntityLink>
      {k && !hideLabel ? (
        <Chip size="sm" tone="accent" title={k.note}>
          {k.label}
        </Chip>
      ) : null}
    </span>
  );
}

export const KIND_ICON: Record<TxKind | 'heartbeat', LucideIcon> = {
  coinbase: Coins,
  transfer: ArrowLeftRight,
  app_message: Boxes,
  node_start: Power,
  node_confirm: ShieldCheck,
  node_tx: Server,
  unknown: CircleHelp,
  heartbeat: HeartPulse,
};

/** The square glyph tile that stands for a transaction kind (kept until every view is on chips). */
export function KindTile({ kind, pulse }: { kind: TxKind | 'heartbeat'; pulse?: boolean }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className="ex-kindtile" data-kind={kind} data-pulse={pulse || undefined} aria-hidden="true">
      <Icon size={15} strokeWidth={1.5} />
    </span>
  );
}
