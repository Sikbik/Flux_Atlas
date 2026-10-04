// How spread out the network is, in the two measures the server computes: the Nakamoto coefficient (the fewest
// countries, providers or operators that together run more than half of the nodes) and the Herfindahl-Hirschman index
// (the sum of squared shares: 0 is evenly spread, 1 is one holder). Said in plain words, as an observation and not a
// verdict. Pure.

import type { DecentralizationDto } from '../../../../api/generated/DecentralizationDto';
import { formatInt } from '../../../../lib/format';
import { hhiBand } from '../../../analytics/lib/stats';

export type Group = 'country' | 'provider' | 'operator';

export interface NakamotoFigure {
  id: Group;
  n: number;
  /** `countries`, `provider`: the noun after the number, agreeing with it. */
  noun: string;
  /** What the number counts, as a label under it. */
  label: string;
}

export type Band = 'low' | 'moderate' | 'high';

export interface HhiFigure {
  id: 'country' | 'provider';
  label: string;
  value: number;
  /** `0.12`. */
  text: string;
  band: Band;
  /** `low concentration`. */
  word: string;
  /** Where the value sits on a three-band gauge, 0..1 (for a marker). */
  at: number;
}

export interface DecentralModel {
  nakamoto: NakamotoFigure[];
  hhi: HhiFigure[];
  /** The plain-language reading: what the numbers say together. */
  reading: string;
  multiNodeHosts: number;
  operators: number;
}

const NOUN: Record<Group, [one: string, many: string]> = {
  country: ['country', 'countries'],
  provider: ['provider', 'providers'],
  operator: ['operator', 'operators'],
};

const noun = (g: Group, n: number) => NOUN[g][n === 1 ? 0 : 1];

const BAND_WORD: Record<Band, string> = {
  low: 'low concentration',
  moderate: 'moderate concentration',
  high: 'high concentration',
};

function nakamotoFigure(id: Group, n: number): NakamotoFigure {
  return { id, n, noun: noun(id, n), label: `${noun(id, n)} run more than half` };
}

/**
 * Where an HHI sits on a gauge cut in three equal bands, low (under 0.15), moderate (0.15 to 0.25) and high (0.25 and
 * over, drawn up to 0.6): the bands are far from equal in width on the true scale, and the reading is the band.
 */
export function gaugeAt(h: number): number {
  if (!Number.isFinite(h) || h <= 0) return 0;
  if (h < 0.15) return h / 0.15 / 3;
  if (h < 0.25) return 1 / 3 + (h - 0.15) / 0.1 / 3;
  return Math.min(1, 2 / 3 + (Math.min(h, 0.6) - 0.25) / 0.35 / 3);
}

function hhiFigure(id: HhiFigure['id'], value: number): HhiFigure {
  const band = hhiBand(value);
  return {
    id,
    label: id === 'country' ? 'Countries' : 'Providers',
    value,
    text: value.toFixed(2),
    band,
    word: BAND_WORD[band],
    at: gaugeAt(value),
  };
}

/**
 * The sentence on how ownership compares with hosting. Fewer operators than countries or providers means a few
 * holders carry as much as a few places do; many more means ownership is spread wider than hosting.
 */
export function ownershipReading(country: number, provider: number, operator: number): string {
  const hosting = Math.max(country, provider);
  if (operator <= 0 || hosting <= 0) return '';
  if (operator >= hosting * 5) return 'Ownership is far more spread out than hosting.';
  if (operator >= hosting * 2) return 'Ownership is more spread out than hosting.';
  if (operator <= hosting)
    return 'A few operators run as much of the network as a few countries or providers do.';
  return 'Ownership and hosting are about equally concentrated.';
}

/** The figures and the reading, or null before the server has any nodes to measure. */
export function decentralModel(d: DecentralizationDto): DecentralModel | null {
  const c = d.nakamoto_country;
  const p = d.nakamoto_provider;
  const o = d.nakamoto_operator;
  if (!(c > 0) && !(p > 0) && !(o > 0)) return null;
  const places = `${formatInt(c)} ${noun('country', c)} and on ${formatInt(p)} ${noun('provider', p)}`;
  const reading = `More than half of all nodes run in ${places}. It takes ${formatInt(o)} ${noun(
    'operator',
    o,
  )} to reach the same share. ${ownershipReading(c, p, o)}`.trim();
  return {
    nakamoto: [nakamotoFigure('country', c), nakamotoFigure('provider', p), nakamotoFigure('operator', o)],
    hhi: [hhiFigure('country', d.hhi_country), hhiFigure('provider', d.hhi_provider)],
    reading,
    multiNodeHosts: d.multi_node_hosts,
    operators: d.operator_count,
  };
}
