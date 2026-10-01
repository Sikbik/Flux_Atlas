// How each kind of entity is written when no explicit label is given: hashes and addresses
// middle-truncated, endpoints formatted, heights grouped (lib/format.ts rules).

import {
  ArrowLeftRight,
  Blocks,
  Boxes,
  Building2,
  Globe,
  type LucideIcon,
  Server,
  Tag,
  UserRoundCheck,
  Wallet,
} from 'lucide-react';
import { formatEndpoint, formatHeight, shortAddress, shortCollateral, shortHash } from '../../lib/format';
import type { EntityKind } from './entityRoute';

const HEX64 = /^[0-9a-fA-F]{64}$/;
const OUTPOINT = /^[0-9a-fA-F]{64}:\d+$/;

/** The default visible text for an entity key. */
export function entityLabel(kind: EntityKind, value: string): string {
  switch (kind) {
    case 'node':
      if (OUTPOINT.test(value)) return shortCollateral(value);
      return /[.[]/.test(value) ? formatEndpoint(value) : value;
    case 'host':
      return formatEndpoint(value);
    case 'block':
      if (/^\d+$/.test(value)) return formatHeight(Number(value));
      return HEX64.test(value) ? shortHash(value) : value;
    case 'tx':
      return shortHash(value);
    case 'address':
    case 'operator':
      return shortAddress(value);
    default:
      return value;
  }
}

/** Kinds whose text is data (ids, addresses, endpoints, heights, versions): set in Plex Mono. */
export function entityIsMono(kind: EntityKind): boolean {
  return kind !== 'app' && kind !== 'country' && kind !== 'provider';
}

/** The Lucide glyph that stands for each kind of entity (design 5.4). */
export const ENTITY_ICONS: Record<EntityKind, LucideIcon> = {
  node: Server,
  host: Server,
  app: Boxes,
  block: Blocks,
  tx: ArrowLeftRight,
  address: Wallet,
  operator: UserRoundCheck,
  country: Globe,
  provider: Building2,
  version: Tag,
};

/** Human noun for each kind, for accessible names ("Open node 65.109.26.93:16147"). */
export const ENTITY_NOUNS: Record<EntityKind, string> = {
  node: 'node',
  host: 'host',
  app: 'app',
  block: 'block',
  tx: 'transaction',
  address: 'address',
  operator: 'operator',
  country: 'country',
  provider: 'provider',
  version: 'version',
};
