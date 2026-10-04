// Where the nodes are, who hosts them and what they run, cut down to the few rows a compact panel shows, with the same
// "leading set" the analytics tabs use: the fewest places that together hold more than half of the nodes, drawn in
// colour while the rest step back to gray. Pure.

import type { CountBucket } from '../../../../api/generated/CountBucket';
import type { GeoBreakdownDto } from '../../../../api/generated/GeoBreakdownDto';
import type { ProvidersDto } from '../../../../api/generated/ProvidersDto';
import { formatInt, formatPercent } from '../../../../lib/format';
import { type Leaders, leaders, nameList, REST_COLOR, shareText } from '../../../analytics/lib/concentration';

export type DistKind = 'country' | 'provider' | 'version';

export interface DistRow {
  id: string;
  label: string;
  count: number;
  share: number;
  shareText: string;
  /** In the leading set (the fewest that together hold more than half). */
  lead: boolean;
  /** The bar's colour: the default blue, or the neutral gray for a row outside the leading set. */
  color: string | undefined;
  /** What a row opens: the globe, with the nodes of that place, provider or version showing. */
  to: { kind: DistKind; value: string } | null;
  /** The row in words, for a hover title. */
  title: string;
}

export interface Distribution {
  /** The rows to draw: the largest few. */
  rows: DistRow[];
  /** How many there are in all. */
  entries: number;
  /** One sentence on who holds the most. */
  reading: string;
}

interface Item {
  key: string;
  label: string;
  count: number;
  share: number;
  to: DistRow['to'];
  /** What to call it in a sentence (a provider's short name). */
  short?: string;
}

const noun = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** A provider's registered name cut to the words that name it ("Hetzner Online GmbH" is "Hetzner Online"). */
export function shortOrg(org: string): string {
  const stop = new Set(['GmbH', 'AG', 'Inc', 'LLC', 'Ltd', 'SAS', 'BV', 'AB', 'AS', 'SA', 'Corp', 'Co']);
  // Punctuation is trimmed from the end of a word only: "Amazon.com, Inc." is "Amazon.com" and not "Amazoncom".
  const words = org.split(/\s+/).map((w) => w.replace(/[,.]+$/, ''));
  return (
    words
      .filter((w) => !stop.has(w))
      .slice(0, 2)
      .join(' ') || org
  );
}

/** The largest `n` of the items as rows, and the leading set over all of them. */
function cut(items: readonly Item[], total: number, n: number): { rows: DistRow[]; lead: Leaders<Item> } {
  const sorted = [...items].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en'));
  const lead = leaders(sorted, total);
  const inLead = new Set(lead.leaders.map((l) => l.key));
  const rows = sorted.slice(0, n).map<DistRow>((i) => ({
    id: i.key,
    label: i.label,
    count: i.count,
    share: i.share,
    shareText: shareText(i.share),
    lead: lead.reached && inLead.has(i.key),
    color: lead.reached && !inLead.has(i.key) ? REST_COLOR : undefined,
    to: i.to,
    title: `${i.label}: ${formatInt(i.count)} nodes, ${shareText(i.share)}${
      i.to ? '. Open to show these nodes on the globe.' : ''
    }`,
  }));
  return { rows, lead };
}

function holdReading(lead: Leaders<Item>, plural: string): string {
  if (!lead.reached) return `The ${plural} listed together do not hold more than half of the nodes yet.`;
  const names = nameList(lead.leaders.map((l) => l.short ?? l.label));
  return `${names} ${lead.leaders.length === 1 ? 'holds' : 'hold'} ${formatPercent(lead.share)} of all nodes.`;
}

/** The countries by node count. */
export function geoDistribution(geo: GeoBreakdownDto, totalNodes: number | null, n = 6): Distribution {
  const items: Item[] = geo.countries.map((c) => ({
    key: c.key,
    label: c.label,
    count: c.count,
    share: c.share,
    to: { kind: 'country', value: c.key },
  }));
  const located = items.reduce((s, i) => s + i.count, 0);
  const { rows, lead } = cut(items, totalNodes ?? located + geo.unlocated, n);
  return { rows, entries: items.length, reading: holdReading(lead, 'countries') };
}

/** The providers by node count (grouped by AS number, so one company's spellings count once). */
export function providerDistribution(dto: ProvidersDto, totalNodes: number | null, n = 6): Distribution {
  const items: Item[] = dto.providers.map((p) => ({
    key: p.asn === null ? p.org : String(p.asn),
    label: p.org,
    short: shortOrg(p.org),
    count: p.nodes,
    share: p.share,
    to: { kind: 'provider', value: p.org },
  }));
  const total = totalNodes ?? items.reduce((s, i) => s + i.count, 0);
  const { rows, lead } = cut(items, total, n);
  return { rows, entries: items.length, reading: holdReading(lead, 'providers') };
}

const isUnknown = (b: CountBucket) => b.key === 'unknown';

/** Dotted versions compared number by number, so 8.20.0 sorts above 8.9.0. */
const compareVersions = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

/** The versions of one component, the most common first and the nodes that do not report one last. */
export function versionDistribution(buckets: readonly CountBucket[], n = 5): Distribution {
  const known = buckets
    .filter((b) => !isUnknown(b))
    .sort((a, b) => b.count - a.count || compareVersions(b.key, a.key));
  const unknown = buckets.find(isUnknown) ?? null;
  const rows: DistRow[] = known.slice(0, n).map((b, i) => ({
    id: b.key,
    label: b.label,
    count: b.count,
    share: b.share,
    shareText: shareText(b.share),
    lead: i === 0,
    color: undefined,
    to: { kind: 'version', value: b.key },
    title: `${b.label}: ${formatInt(b.count)} nodes, ${shareText(b.share)}. Open to show these nodes on the globe.`,
  }));
  if (unknown && unknown.count > 0) {
    rows.push({
      id: unknown.key,
      label: 'Not reported',
      count: unknown.count,
      share: unknown.share,
      shareText: shareText(unknown.share),
      lead: false,
      color: REST_COLOR,
      to: null,
      title: `${formatInt(unknown.count)} nodes do not report a version, ${shareText(unknown.share)}`,
    });
  }
  const top = known[0];
  const others = known.length - 1;
  const reading = top
    ? `${formatPercent(top.share)} of nodes run ${top.label}${
        others > 0 ? `; ${formatInt(others)} other ${noun(others, 'version is', 'versions are')} in use` : ''
      }.`
    : 'No version is reported yet.';
  return { rows, entries: known.length, reading };
}
