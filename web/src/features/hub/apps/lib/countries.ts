// Where the running instances are: the ranked countries, the instances on nodes with no known location kept as a row
// of their own (they are real instances in an unknown place, never dropped and never a zero), the few countries that
// together host more than half, and the sentence that says so. Pure.
//
// The numbers are the server's stored app locations by the country of the node they run on
// (`countries` and `unlocated_instances` of `GET /network/apps-overview`).

import type { AppCountryRow } from '../../../../api/generated/AppCountryRow';
import { formatInt } from '../../../../lib/format';
import { leaders, nameList, shareText } from '../../../analytics/lib/concentration';

export const UNKNOWN_LOCATION = 'Unknown location';

export interface CountryRow {
  /** The row's key: the ISO code, or `unknown`. */
  id: string;
  /** The ISO country code; null for the row of instances with no known location. */
  code: string | null;
  name: string;
  instances: number;
  /** A fraction of every running instance with a stored location, the unlocated ones included. */
  share: number;
  /** One of the fewest countries that together host more than half. */
  lead: boolean;
}

export interface CountryModel {
  /** The countries, most instances first. */
  rows: CountryRow[];
  /**
   * What the bars list: the countries with the unlocated instances placed where their count ranks (so they are
   * not hidden at the bottom of a folded list), or left out when there are none.
   */
  ranked: CountryRow[];
  /** The instances with no known location. Always present, a zero only when every instance is located. */
  unknown: CountryRow;
  /** Instances counted: located plus unlocated. */
  total: number;
  located: number;
  /** How many countries host at least one instance. */
  countries: number;
  /** How many countries it takes to pass half of `total`, and whether the located ones do. */
  leaders: { n: number; share: number; reached: boolean; names: string[] };
}

export function countryModel(countries: readonly AppCountryRow[], unlocated: number): CountryModel {
  const sorted = [...countries]
    .filter((c) => c.instances > 0)
    .sort((a, b) => b.instances - a.instances || (a.code < b.code ? -1 : 1));
  const located = sorted.reduce((s, c) => s + c.instances, 0);
  const total = located + Math.max(0, unlocated);
  const lead = leaders(
    sorted.map((c) => ({ key: c.code, label: c.name, count: c.instances })),
    total,
  );
  const inLead = new Set(lead.leaders.map((l) => l.key));
  const share = (n: number): number => (total > 0 ? n / total : 0);
  const rows: CountryRow[] = sorted.map((c) => ({
    id: c.code,
    code: c.code,
    name: c.name,
    instances: c.instances,
    share: share(c.instances),
    lead: lead.reached && inLead.has(c.code),
  }));
  const unknown: CountryRow = {
    id: 'unknown',
    code: null,
    name: UNKNOWN_LOCATION,
    instances: Math.max(0, unlocated),
    share: share(Math.max(0, unlocated)),
    lead: false,
  };
  const at = rows.findIndex((r) => r.instances < unknown.instances);
  const place = at === -1 ? rows.length : at;
  return {
    rows,
    ranked: unknown.instances > 0 ? [...rows.slice(0, place), unknown, ...rows.slice(place)] : rows,
    unknown,
    total,
    located,
    countries: sorted.length,
    leaders: { n: lead.n, share: lead.share, reached: lead.reached, names: lead.leaders.map((l) => l.label) },
  };
}

/** The headline of the panel: who hosts half, or that the located countries do not reach half. */
export function countryHeadline(m: CountryModel): string {
  if (m.total === 0) return '';
  const { leaders: l } = m;
  if (l.reached) {
    const who = nameList(l.names);
    return `${who} ${l.n === 1 ? 'alone hosts' : 'together host'} ${shareText(l.share)} of the running instances.`;
  }
  return `The located countries host ${shareText(l.share)} of the running instances; the rest are in places the server cannot locate.`;
}

/** The sentence for a screen reader, ahead of the bars. */
export function countrySummary(m: CountryModel): string {
  if (m.total === 0) return 'No running instance has a stored location.';
  const parts = [
    `${formatInt(m.total)} running ${m.total === 1 ? 'instance' : 'instances'} in ${formatInt(m.countries)} ${m.countries === 1 ? 'country' : 'countries'}.`,
    countryHeadline(m),
  ];
  if (m.unknown.instances > 0) {
    parts.push(`${formatInt(m.unknown.instances)} have no known location.`);
  }
  return parts.filter(Boolean).join(' ');
}
