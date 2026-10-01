// Small pieces several explorer views share: node references resolved from the live store, address
// labels, and the glyph tile of a transaction kind. Built from the kit; what is here is only what needs
// the live store or this feature's knowledge of entities.

import { type LinkOptions, useLinkProps } from '@tanstack/react-router';
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
import type { ReactNode } from 'react';
import type { TxKind } from '../../../api/generated/TxKind';
import { splitCountry } from '../../../api/nodesBin';
import { useNetwork } from '../../../app/context';
import { localNodeId } from '../../../store/nodeKeys';
import { shallowEqual } from '../../../store/react';
import { Chip, cx, EntityLink, TierGlyph, type TierName, Unknown } from '../../../ui';
import { knownEntity } from '../lib/entities';
import './shared.css';

const TIERS = ['unknown', 'cumulus', 'nimbus', 'stratus'] as const;

export interface NodeInfo {
  endpoint: string;
  tier: TierName | 'unknown';
  cc: string;
  /** The country's name ('' when the table lists only a code). */
  country: string;
  /** The city the node's address resolves to, or '' when the server has no city for it. */
  city: string;
}

/**
 * A node's endpoint, tier, country and city from the live node table (null when it is not listed).
 * A server record's id is the answering instance's, so its outpoint, when given, names the node.
 */
export function useNodeInfo(id: number | null | undefined, outpoint?: string | null): NodeInfo | null {
  const t = useNetwork(
    (s) => {
      if (id === null || id === undefined) {
        if (!outpoint) return null;
      }
      const local = localNodeId(s.nodes, { id: id ?? -1, outpoint: outpoint ?? null });
      if (local === null) return null;
      const i = s.nodes.indexOf(local);
      if (i < 0) return null;
      const city = s.nodes.locations.info(s.nodes.loc[i] ?? 0)?.city ?? '';
      const country = splitCountry(s.nodes.countries.get(s.nodes.country[i] ?? 0)).name;
      return [s.nodes.endpoint(i), s.nodes.tier[i] ?? 0, s.nodes.countryCode(i), city, country] as const;
    },
    (a, b) =>
      a === b || (a !== null && b !== null && shallowEqual(a as readonly unknown[], b as readonly unknown[])),
  );
  if (!t) return null;
  return { endpoint: t[0], tier: TIERS[t[1]] ?? 'unknown', cc: t[2], city: t[3], country: t[4] };
}

/**
 * The city named on an API object, if it carries one. The server now sends `city` on a block's
 * producer; reading it by name keeps this working for objects that do not have the field.
 */
export function cityOf(x: object | null | undefined): string {
  const c = (x as { city?: unknown } | null | undefined)?.city;
  return typeof c === 'string' ? c.trim() : '';
}

/**
 * Marks its children as a dense, data-heavy surface (a table, a long live list): the interaction
 * effects of the motion language stay quiet there. It adds no box of its own.
 */
export function Dense({ children }: { children: ReactNode }) {
  return (
    <div className="ex-dense" data-fx-density="dense">
      {children}
    </div>
  );
}

/** A node as a link: tier glyph, then `ip:port` (or the id when the node is not in the table). */
export function NodeLink({
  id,
  fallbackEndpoint,
  fallbackTier,
  glyph = true,
  outpoint,
}: {
  id: number | null | undefined;
  fallbackEndpoint?: string | null;
  fallbackTier?: string | null;
  glyph?: boolean;
  /** The node's collateral outpoint, when the record carries it: the link key, and how the table finds it. */
  outpoint?: string | null;
}) {
  const info = useNodeInfo(id, outpoint);
  const endpoint = info?.endpoint || fallbackEndpoint || null;
  const tier = (info?.tier ?? (fallbackTier as TierName | null) ?? 'unknown') as TierName | 'unknown';
  const key = outpoint || endpoint || (id !== null && id !== undefined ? String(id) : null);
  if (!key) return <Unknown>Unknown node</Unknown>;
  return (
    <span className="ex-nodelink">
      {glyph ? <TierGlyph tier={tier} size={14} /> : null}
      <EntityLink kind="node" value={key} mono>
        {endpoint ?? (id !== null && id !== undefined ? `Node ${id}` : 'Node')}
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

/**
 * A link to a window route that has no key (`/richlist`, `/mempool`, `/supply`, `/analytics`). The kit's
 * EntityLink covers entities; this covers the views themselves, keeping the camera and filters in the URL.
 */
export function RouteLink({
  to,
  search,
  children,
  className,
}: {
  to: string;
  search?: Record<string, unknown>;
  children: ReactNode;
  className?: string;
}) {
  const props = useLinkProps({
    to,
    search: (prev: Record<string, unknown>) => ({ ...prev, ...search }),
  } as unknown as LinkOptions);
  return (
    <a {...props} className={cx('ui-entity', className)}>
      {children}
    </a>
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
