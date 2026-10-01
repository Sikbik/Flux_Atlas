// Spec archaeology: turns an app's permanent messages into a readable history.
//
// The server records, for every message after the first, which spec fields changed
// (`AppHistoryEntry.changed`, field paths such as `instances` or `components.web.ram_mb`). It does
// not store the old and new values, so a diff here is honest about what it knows: the field and the
// direction (added, removed, changed) for every message, the spec version on both sides, FLUX paid,
// and the actual new values for the app's current version (from the live spec).

import type { AppHistoryEntry } from '../../../api/generated/AppHistoryEntry';
import type { AppSpec } from '../../../api/generated/AppSpec';
import { formatInt, parseFlux } from '../../../lib/format';
import { envNames, formatGeoRules } from './appSpec';

export type ChangeKind = 'changed' | 'added' | 'removed';

export interface ChangeLine {
  /** The raw path from the server. */
  path: string;
  /** What changed, in words: `Memory`, `Image`, `Instance count`. */
  label: string;
  /** The component this belongs to; null for app-level fields. */
  scope: string | null;
  kind: ChangeKind;
  /** The field name without its scope. */
  field: string;
  /** The new value, when known (the current version only). */
  value?: string;
}

const APP_FIELDS: Record<string, string> = {
  spec_version: 'Spec version',
  description: 'Description',
  owner: 'Owner',
  instances: 'Instance count',
  contacts: 'Contacts',
  geolocation: 'Geographic rules',
  expire_blocks: 'Lifetime',
  nodes: 'Pinned nodes',
  static_ip: 'Static IP requirement',
  enterprise: 'Enterprise mode',
  datacenter: 'Datacenter requirement',
};

const COMPONENT_FIELDS: Record<string, string> = {
  name: 'Name',
  repotag: 'Image',
  ports: 'Ports',
  container_ports: 'Container ports',
  domains: 'Domains',
  environment: 'Environment variables',
  commands: 'Commands',
  container_data: 'Container data',
  cpu: 'CPU',
  ram_mb: 'Memory',
  hdd_gb: 'Disk',
  description: 'Description',
  tiered: 'Tiered resources',
  has_repoauth: 'Registry credentials',
  has_secrets: 'Secrets',
};

/** Splits a server change path into its scope, field and direction. */
export function parseChange(path: string): Omit<ChangeLine, 'value'> {
  if (path.startsWith('components.')) {
    const rest = path.slice('components.'.length);
    if (rest.endsWith('+') || rest.endsWith('-')) {
      const kind: ChangeKind = rest.endsWith('+') ? 'added' : 'removed';
      const name = rest.slice(0, -1);
      return { path, scope: name, field: 'component', kind, label: `Component ${name}` };
    }
    const dot = rest.lastIndexOf('.');
    const name = dot < 0 ? rest : rest.slice(0, dot);
    const field = dot < 0 ? '' : rest.slice(dot + 1);
    return {
      path,
      scope: name,
      field,
      kind: 'changed',
      label: COMPONENT_FIELDS[field] ?? field.replaceAll('_', ' '),
    };
  }
  return {
    path,
    scope: null,
    field: path,
    kind: 'changed',
    label: APP_FIELDS[path] ?? path.replaceAll('_', ' '),
  };
}

/**
 * Everything one history item is made of. `n` is the message number (1-based, every message counts);
 * `rev` is the revision of the spec (1-based, only registrations and updates define a new one), which
 * is what `/app/:name/history/:n` deep-links.
 */
export type HistoryItem =
  | { type: 'registered'; n: number; rev: number; again: boolean; entry: AppHistoryEntry }
  | {
      type: 'updated';
      n: number;
      rev: number;
      entry: AppHistoryEntry;
      /** Spec version of the previous message, null for the first. */
      versionFrom: number | null;
      versionTo: number;
      changes: ChangeLine[];
      ownerChanged: boolean;
    }
  | {
      type: 'renewals';
      /** First and last message numbers of the run. */
      from: number;
      to: number;
      entries: AppHistoryEntry[];
      /** Total paid across the run, in base units. */
      paid: bigint;
      specVersion: number;
    };

export function buildHistory(entries: readonly AppHistoryEntry[]): HistoryItem[] {
  const out: HistoryItem[] = [];
  let seenRegister = false;
  let rev = 0;
  entries.forEach((entry, i) => {
    const n = i + 1;
    const prevVersion = i > 0 ? entries[i - 1]!.spec_version : null;
    if (entry.kind === 'registered') {
      rev++;
      out.push({ type: 'registered', n, rev, again: seenRegister, entry });
      seenRegister = true;
      return;
    }
    if (entry.kind === 'renewed' || entry.kind === 'expired') {
      const last = out.at(-1);
      const paid = parseFlux(entry.paid) ?? 0n;
      if (last?.type === 'renewals') {
        last.to = n;
        last.entries.push(entry);
        last.paid += paid;
      } else {
        out.push({
          type: 'renewals',
          from: n,
          to: n,
          entries: [entry],
          paid,
          specVersion: entry.spec_version,
        });
      }
      return;
    }
    const changes = entry.changed.map(parseChange);
    rev++;
    out.push({
      type: 'updated',
      n,
      rev,
      entry,
      versionFrom: prevVersion,
      versionTo: entry.spec_version,
      changes,
      ownerChanged: entry.changed.includes('owner'),
    });
  });
  return out;
}

/** The registration or update that defines revision `rev`, or null when there is none. */
export function findRevision(items: readonly HistoryItem[], rev: number): HistoryItem | null {
  for (const it of items)
    if ((it.type === 'registered' || it.type === 'updated') && it.rev === rev) return it;
  return null;
}

/** Number of spec revisions (registrations and updates) in a history. */
export function revisionCount(items: readonly HistoryItem[]): number {
  let n = 0;
  for (const it of items) if (it.type !== 'renewals') n = Math.max(n, it.rev);
  return n;
}

/** Total FLUX paid across every message, in base units. */
export function totalPaid(entries: readonly AppHistoryEntry[]): bigint {
  let sum = 0n;
  for (const e of entries) sum += parseFlux(e.paid) ?? 0n;
  return sum;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`;
}

/** The current value of a changed field, formatted for reading. Environment values are never shown. */
export function currentValue(spec: AppSpec, c: Omit<ChangeLine, 'value'>): string | undefined {
  if (c.scope === null) {
    switch (c.field) {
      case 'spec_version':
        return `v${spec.spec_version}`;
      case 'instances':
        return formatInt(spec.instances);
      case 'description':
        return spec.description.length > 90 ? `${spec.description.slice(0, 89)}…` : spec.description;
      case 'owner':
        return spec.owner;
      case 'expire_blocks':
        return spec.expire_blocks === null ? 'default' : `${formatInt(spec.expire_blocks)} blocks`;
      case 'geolocation':
        return spec.geolocation.length ? formatGeoRules(spec.geolocation) : 'none';
      case 'contacts':
        return plural(spec.contacts.length, 'contact');
      case 'nodes':
        return spec.nodes.length ? plural(spec.nodes.length, 'pinned node') : 'none';
      case 'static_ip':
        return spec.static_ip ? 'required' : 'not required';
      case 'enterprise':
        return spec.enterprise ? 'enterprise' : 'public';
      case 'datacenter':
        return spec.datacenter === null ? 'unspecified' : spec.datacenter ? 'datacenter only' : 'any host';
      default:
        return undefined;
    }
  }
  const comp = spec.components.find((x) => x.name === c.scope);
  if (!comp) return undefined;
  switch (c.field) {
    case 'repotag':
      return comp.repotag;
    case 'ports':
      return comp.ports.join(', ') || 'none';
    case 'container_ports':
      return comp.container_ports.join(', ') || 'none';
    case 'domains': {
      const d = comp.domains.filter(Boolean);
      return d.length ? d.join(', ') : 'none';
    }
    case 'environment': {
      const names = envNames(comp.environment);
      return names.length ? `${plural(names.length, 'variable')}, values hidden` : 'none';
    }
    case 'commands':
      return plural(comp.commands.length, 'command');
    case 'cpu':
      return `${comp.cpu} CPU`;
    case 'ram_mb':
      return `${formatInt(comp.ram_mb)} MB`;
    case 'hdd_gb':
      return `${formatInt(comp.hdd_gb)} GB`;
    case 'container_data':
      return comp.container_data || 'none';
    case 'description':
      return comp.description.length > 60 ? `${comp.description.slice(0, 59)}…` : comp.description;
    case 'name':
      return comp.name;
    case 'tiered':
      return comp.tiered ? 'yes' : 'no';
    case 'has_repoauth':
      return comp.has_repoauth ? 'present, hidden' : 'none';
    case 'has_secrets':
      return comp.has_secrets ? 'present, hidden' : 'none';
    default:
      return undefined;
  }
}

/** Adds current values to the changes of the item that is the app's current version. */
export function withCurrentValues(item: HistoryItem, spec: AppSpec): HistoryItem {
  if (item.type !== 'updated') return item;
  return { ...item, changes: item.changes.map((c) => ({ ...c, value: currentValue(spec, c) })) };
}

/** A one-line summary of what an update did, for collapsed rows. */
export function summarizeChanges(changes: readonly ChangeLine[]): string {
  if (changes.length === 0) return 'No fields changed';
  const added = changes.filter((c) => c.kind === 'added').map((c) => c.scope);
  const removed = changes.filter((c) => c.kind === 'removed').map((c) => c.scope);
  const parts: string[] = [];
  if (added.length) parts.push(`added ${added.join(', ')}`);
  if (removed.length) parts.push(`removed ${removed.join(', ')}`);
  const fields = [...new Set(changes.filter((c) => c.kind === 'changed').map((c) => c.label.toLowerCase()))];
  if (fields.length)
    parts.push(
      fields.length > 3
        ? `${fields.slice(0, 3).join(', ')} and ${fields.length - 3} more`
        : fields.join(', '),
    );
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Groups a change list by component for display: app-level fields first, then each component. */
export function groupChanges(
  changes: readonly ChangeLine[],
): { scope: string | null; lines: ChangeLine[] }[] {
  const groups: { scope: string | null; lines: ChangeLine[] }[] = [];
  const app = changes.filter((c) => c.scope === null);
  if (app.length) groups.push({ scope: null, lines: app });
  const scopes: string[] = [];
  for (const c of changes) if (c.scope !== null && !scopes.includes(c.scope)) scopes.push(c.scope);
  for (const s of scopes) groups.push({ scope: s, lines: changes.filter((c) => c.scope === s) });
  return groups;
}
