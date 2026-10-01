// The boot log's lines (design 9.1): each stage's label is fixed and its right-hand value is a real number
// from the snapshot, counted up while the stage runs. Until the snapshot is in there is nothing to count,
// so a running stage says what it is doing in words ("receiving") instead of showing a number.

import { formatHeight, formatInt } from '../../../lib/format';
import type { StageId, StageView } from './model';

export interface BootFacts {
  /** Round trip to the first byte of the bootstrap request, ms. */
  ttfbMs: number | null;
  tipHeight: number | null;
  nodes: number | null;
  hosts: number | null;
  countries: number | null;
  apps: number | null;
  instances: number | null;
  /** `19:46`, the server's UTC clock. */
  utcHM: string;
  /** Seconds to the next block, when known. */
  nextS: number | null;
}

export const NO_FACTS: BootFacts = {
  ttfbMs: null,
  tipHeight: null,
  nodes: null,
  hosts: null,
  countries: null,
  apps: null,
  instances: null,
  utcHM: '',
  nextS: null,
};

const counted = (n: number, u: number): string => formatInt(Math.round(n * Math.min(1, Math.max(0, u))));

export function lineValue(id: StageId, state: StageView['state'], u: number, f: BootFacts): string {
  if (state === 'wait') return '';
  if (state === 'fail') return 'fail';
  const done = state === 'done';
  switch (id) {
    case 'connect':
      return done ? (f.ttfbMs === null ? 'connected' : `Atlas answered, ${f.ttfbMs} ms`) : 'opening';
    case 'tip':
      return done ? (f.tipHeight === null ? 'synced' : `block ${formatHeight(f.tipHeight)}`) : 'asking';
    case 'nodes':
      if (f.nodes === null) return 'receiving';
      return `${counted(f.nodes, done ? 1 : u)} of ${formatInt(f.nodes)}`;
    case 'hosts':
      if (f.hosts === null) return 'placing';
      if (!done) return `${counted(f.hosts, u)} hosts`;
      return f.countries === null
        ? `${formatInt(f.hosts)} hosts`
        : `${formatInt(f.hosts)} hosts, ${formatInt(f.countries)} countries`;
    case 'apps':
      if (f.apps === null) return 'reading';
      if (!done) return `${counted(f.apps, u)} apps`;
      return f.instances === null
        ? `${formatInt(f.apps)} apps`
        : `${formatInt(f.apps)} apps, ${formatInt(f.instances)} instances`;
    case 'sun':
      return done ? `${f.utcHM} UTC, terminator set` : 'reading the clock';
    case 'stream':
      return done ? (f.nextS === null ? 'live' : `next block in ${f.nextS} s`) : 'subscribing';
  }
}

/** What a screen reader hears as the boot moves on: the running stage, in words. */
export function announce(running: StageView | null, percent: number): string {
  return running
    ? `Loading Flux Atlas, ${percent} percent: ${running.label}`
    : `Loading Flux Atlas, ${percent} percent`;
}
