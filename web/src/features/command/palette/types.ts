// Shared shapes of the palette model: rows, groups, the parsed input. The model is pure data (no React),
// so the palette, the `/q/$text` results page and the terminal's `search` all render the same rows.

import type { NavTarget } from '../navigation';

export type TierName = 'cumulus' | 'nimbus' | 'stratus';

/** Result groups in display order (design 8.6), then the empty-query groups. */
export type GroupId =
  | 'recent'
  | 'next'
  | 'try'
  | 'nodes'
  | 'hosts'
  | 'apps'
  | 'blocks'
  | 'txs'
  | 'addresses'
  | 'goto'
  | 'commands';

export const GROUP_ORDER: readonly GroupId[] = [
  'recent',
  'next',
  'try',
  'nodes',
  'hosts',
  'apps',
  'blocks',
  'txs',
  'addresses',
  'goto',
  'commands',
];

export const GROUP_LABEL: Record<GroupId, string> = {
  recent: 'Recent',
  next: 'Next payees',
  try: 'Try',
  nodes: 'Nodes',
  hosts: 'Hosts and providers',
  apps: 'Apps',
  blocks: 'Blocks',
  txs: 'Transactions',
  addresses: 'Addresses',
  goto: 'Go to',
  commands: 'Commands',
};

/** The kind chips under the input (Tab cycles them). Each shows some groups. */
export type KindChip = 'all' | 'nodes' | 'apps' | 'blocks' | 'addresses' | 'goto';

export const KIND_CHIPS: readonly { id: KindChip; label: string; groups: readonly GroupId[] }[] = [
  { id: 'all', label: 'All', groups: GROUP_ORDER },
  { id: 'nodes', label: 'Nodes', groups: ['nodes', 'hosts'] },
  { id: 'apps', label: 'Apps', groups: ['apps'] },
  { id: 'blocks', label: 'Blocks', groups: ['blocks', 'txs'] },
  { id: 'addresses', label: 'Addresses', groups: ['addresses'] },
  { id: 'goto', label: 'Go to', groups: ['goto', 'commands'] },
];

export type RowKind =
  | 'node'
  | 'host'
  | 'provider'
  | 'app'
  | 'block'
  | 'tx'
  | 'address'
  | 'operator'
  | 'country'
  | 'city'
  | 'version'
  | 'place'
  | 'action'
  | 'shielded'
  | 'payee'
  | 'egg';

/** The glyph a row wears; the palette maps each to a Lucide icon (or the tier meter for nodes). */
export type IconId =
  | 'node'
  | 'host'
  | 'provider'
  | 'app'
  | 'block'
  | 'tx'
  | 'address'
  | 'operator'
  | 'country'
  | 'city'
  | 'version'
  | 'place'
  | 'globe'
  | 'queue'
  | 'analytics'
  | 'explorer'
  | 'time'
  | 'weather'
  | 'terminal'
  | 'settings'
  | 'award'
  | 'moon'
  | 'ambient'
  | 'mesh'
  | 'filter'
  | 'art'
  | 'perf'
  | 'motion'
  | 'sound'
  | 'link'
  | 'info'
  | 'egg'
  | 'search'
  | 'watch';

/** A node's state as the node table reports it; the kit's StatusChip draws each of these. */
export type NodeStatusKind =
  | 'unknown'
  | 'confirmed'
  | 'started'
  | 'dos'
  | 'offline'
  | 'expired'
  | 'departed'
  | 'unreachable';

export type RowMeta =
  | { type: 'status'; status: NodeStatusKind }
  | { type: 'keys'; keys: readonly string[] }
  | { type: 'text'; text: string }
  | { type: 'current' };

export type RowAction =
  | { type: 'go'; target: NavTarget }
  /** Runs an action by id (`run.ts`); `arg` carries what the id needs (a filter expression, a view). */
  | { type: 'run'; id: string; arg?: string }
  /** Replaces the input text (prefix hints such as `node `). */
  | { type: 'type'; text: string }
  /** Explains something and does nothing (a shielded address). */
  | { type: 'none' };

export interface FlyView {
  lat: number;
  lon: number;
  /** Camera range in globe radii (`GlobeTarget.flyTo`). */
  alt: number;
}

/** What is remembered when a row is run, so it can come back under "Recent". */
export interface RecentEntry {
  id: string;
  kind: RowKind;
  icon: IconId;
  title: string;
  mono?: boolean;
  sub?: string;
  subMono?: boolean;
  chip: string;
  tier?: TierName;
  action: RowAction;
  fly?: FlyView;
  alsoFly?: boolean;
  alongside?: boolean;
  ts: number;
}

export interface PaletteRow {
  id: string;
  group: GroupId;
  kind: RowKind;
  icon: IconId;
  title: string;
  /** Identifiers (IPs, hashes, addresses) read in the data face. */
  mono?: boolean;
  sub?: string;
  /** The sub-line is an identifier too (a block's hash). */
  subMono?: boolean;
  /** The typed chip at the right: what kind of thing this row is (Node, Block, App). */
  chip: string;
  tier?: TierName;
  meta?: RowMeta;
  score: number;
  action: RowAction;
  /** Alt+Enter flies the camera here without opening anything. */
  fly?: FlyView;
  /** Enter flies the camera to `fly` as well as running the action (a country: filter and frame it). */
  alsoFly?: boolean;
  /** Shift+Enter can open this row alongside the current window (it targets a window). */
  alongside?: boolean;
  /** Whether the row is saved under "Recent" when run. */
  remember?: boolean;
}

export interface RowGroup {
  id: GroupId;
  label: string;
  rows: PaletteRow[];
  /** Matches beyond the rows shown (the results page lists them all). */
  more: number;
}

export type Prefix = 'node' | 'app' | 'block' | 'tx' | 'addr' | 'operator' | 'goto' | 'layer' | 'filter';

export const PREFIXES: readonly { id: Prefix; hint: string; example: string; summary: string }[] = [
  {
    id: 'node',
    hint: 'node <ip, ip:port or collateral>',
    example: 'node 65.109',
    summary: 'Find a node or host',
  },
  { id: 'app', hint: 'app <name>', example: 'app BitcoinWhitepaper', summary: 'Find an app' },
  { id: 'block', hint: 'block <height or hash>', example: 'block tip', summary: 'Open a block' },
  { id: 'tx', hint: 'tx <txid>', example: 'tx 8aa97365', summary: 'Open a transaction' },
  { id: 'addr', hint: 'addr <address>', example: 'addr t1cz5PE2Q', summary: 'Open an address' },
  {
    id: 'operator',
    hint: 'operator <address or ZelID>',
    example: 'operator t1cz5P',
    summary: 'Open an operator',
  },
  { id: 'goto', hint: 'goto <place or lat,lon>', example: 'goto helsinki', summary: 'Fly the camera' },
  { id: 'layer', hint: 'layer <name>', example: 'layer mesh', summary: 'Show or hide a layer' },
  {
    id: 'filter',
    hint: 'filter <expression>',
    example: 'filter stratus',
    summary: 'Dim the rest of the globe',
  },
];

export interface ParsedInput {
  /** The text exactly as typed. */
  raw: string;
  /** The query without its prefix, trimmed. */
  text: string;
  prefix: Prefix | null;
}

export interface PaletteModel {
  input: ParsedInput;
  groups: RowGroup[];
  /** The best hit: the first row of the first group. */
  best: PaletteRow | null;
  /** The query to send to the server, or null when the server has nothing to add. */
  serverQuery: string | null;
  /** True when no group matched at all. */
  empty: boolean;
  /** Rows per kind chip (before the chip filters the groups), so the chips can show counts. */
  counts: Record<KindChip, number>;
  /** "See all results" (opens the `/q/` page), offered when the list is long. */
  seeAll: PaletteRow | null;
  /** The usage line of the typed prefix (`node <ip, ip:port or collateral>`). */
  usage: string | null;
}
