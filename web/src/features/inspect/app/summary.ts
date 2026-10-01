// One-line summaries for the folds of the app view. A fold's aside shares its row with the title, so each
// of these is a few words whatever the spec holds: a long list becomes a count, never the list.

import type { GeoRule } from '../../../api/generated/GeoRule';
import { formatInt } from '../../../lib/format';
import { describeGeoPlace, parseImage } from '../derive/appSpec';

/** `1 day`, `3 days`: the count with its noun, grouped like every figure. */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${formatInt(n)} ${n === 1 ? one : many}`;

/** The longest image name worth putting beside the component count. */
const IMAGE_NAME_MAX = 20;

/** `2 components`, or for a single one its image name (`1 component · folding-at-home`) when that is short. */
export function componentsSummary(repotags: readonly string[]): string {
  const count = plural(repotags.length, 'component');
  if (repotags.length !== 1) return count;
  const name = parseImage(repotags[0] ?? '')
    ?.repository.split('/')
    .pop();
  return name && name.length <= IMAGE_NAME_MAX ? `${count} · ${name}` : count;
}

/** What the placement rules say: one rule by its name, several by their count, else the kind of host asked for. */
export function placementSummary(spec: {
  geolocation: readonly GeoRule[];
  static_ip: boolean;
  datacenter: boolean | null;
  nodes: readonly string[];
}): string {
  const rules = spec.geolocation;
  const only = rules.length === 1 ? rules[0] : undefined;
  if (only) return `${only.allow ? 'Only in' : 'Never in'} ${describeGeoPlace(only)}`;
  if (rules.length > 1) {
    const allowed = rules.filter((r) => r.allow).length;
    const never = rules.length - allowed;
    return [allowed ? `${allowed} allowed` : null, never ? `${never} forbidden` : null]
      .filter(Boolean)
      .join(' · ');
  }
  if (spec.nodes.length) return `Pinned to ${plural(spec.nodes.length, 'host')}`;
  if (spec.static_ip || spec.datacenter !== null) return 'Host requirements';
  return 'Anywhere';
}

/** `98 of 100 · 2 installing`, else `100 of 100 · 13 countries`: how many run, then the one thing worth adding. */
export function instancesSummary(i: {
  running: number;
  target: number;
  installing: number;
  countries: number;
}): string {
  const head = `${formatInt(i.running)} of ${formatInt(i.target)}`;
  if (i.installing > 0) return `${head} · ${formatInt(i.installing)} installing`;
  if (i.countries > 0) return `${head} · ${plural(i.countries, 'country', 'countries')}`;
  return head;
}
