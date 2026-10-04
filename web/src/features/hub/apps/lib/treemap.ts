// The top-apps picture's inputs: which apps get a cell, how many fit, what the apps without one hold, and the facts a
// cell's tooltip and the caption under the picture say. The geometry is the wallet's squarified treemap
// (`wallet/lib/treemap.ts`); this file only decides what is laid out. Pure.
//
// The picture draws the biggest apps to scale against each other and nothing else. The long tail (most apps run an
// instance or two) is not folded into a block that would take most of the area and say nothing: what it holds is told
// by a share bar under the picture and a sentence.

import { formatInt, formatPercent, middleTruncate } from '../../../../lib/format';
import { formatCapacity } from '../../../analytics/lib/capacity';
import { cellLimit, type TreemapItem } from '../../../wallet/lib/treemap';
import { type AppRank, type RankBy, rankValue } from './apps';

/** The most named cells a picture draws. */
export const MAX_CELLS = 30;
/** Fewer than this and a picture is not a picture. */
export const MIN_CELLS = 8;
/** A cell has at least this much area (px squared): room for a name and a figure, an 80 by 60 px block. */
export const MIN_CELL_AREA = 4800;

/** How many cells a box of `width` by `height` px draws. */
export function cellBudget(width: number, height: number): number {
  return Math.max(MIN_CELLS, Math.min(MAX_CELLS, cellLimit(width, height, MIN_CELL_AREA, MIN_CELLS)));
}

/** The items of the picture: the biggest `limit` apps by `by`. */
export function mapItems(ranked: readonly AppRank[], by: RankBy, limit: number): TreemapItem[] {
  return ranked.slice(0, limit).map((r) => ({ id: r.name, label: r.label, value: rankValue(r, by) }));
}

export interface TailSplit {
  /** What the drawn apps hold (instances, or footprint), and what the rest hold. */
  drawn: number;
  rest: number;
  /** How many apps are not drawn. */
  restApps: number;
  /** The fraction of the whole the drawn apps hold; 0 when there is nothing. */
  share: number;
}

/** What the apps with a cell hold of the whole, and what the apps without one hold. */
export function tailSplit(ranked: readonly AppRank[], by: RankBy, limit: number): TailSplit {
  let drawn = 0;
  let rest = 0;
  ranked.forEach((r, i) => {
    if (i < limit) drawn += rankValue(r, by);
    else rest += rankValue(r, by);
  });
  const whole = drawn + rest;
  return { drawn, rest, restApps: Math.max(0, ranked.length - limit), share: whole > 0 ? drawn / whole : 0 };
}

/** The width in px of a piece of text in the cells' face. The picture measures with a canvas; tests use the estimate. */
export type Measure = (text: string) => number;

/** About how wide a character of an app's name is in a cell, in px (the interface face at 12 px). */
const NAME_CHAR_PX = 6.4;
/** The same, counted a little wide so that a line which "fits" does fit, and the ellipsis, which is wider than a letter. */
const LINE_CHAR_PX = 6.7;
const ELLIPSIS_PX = 12;

/** A guess at the width of a text in a cell, from its length, for where nothing can be measured. */
export const estimateWidth: Measure = (text) => {
  let width = 0;
  for (const ch of text) width += ch === '…' ? ELLIPSIS_PX : LINE_CHAR_PX;
  return width;
};

/**
 * An app's name cut in the middle to fit `widthPx`, keeping its end: the names of a family differ at the end
 * (`FoldingA...ux29`), and that is the part a reader needs. A name that fits is left alone. With a `measure` the cut
 * is made until the text really fits; without one it goes by a character count.
 */
export function fitName(name: string, widthPx: number, measure?: Measure): string {
  if (measure) {
    if (measure(name) <= widthPx) return name;
    for (let keep = name.length - 1; keep >= 4; keep--) {
      const tail = Math.min(5, Math.max(3, Math.floor(keep * 0.4)));
      const cut = middleTruncate(name, keep - tail, tail);
      if (measure(cut) <= widthPx) return cut;
    }
    return middleTruncate(name, 2, 2);
  }
  const chars = Math.max(5, Math.floor(widthPx / NAME_CHAR_PX));
  if (name.length <= chars) return name;
  const keep = chars - 1;
  const tail = Math.min(5, Math.max(3, Math.floor(keep * 0.4)));
  return middleTruncate(name, keep - tail, tail);
}

/** The shorter line of a two-line name has at least this many characters, and a third of the name. */
const MIN_LINE = 3;
/** A natural break whose lines differ by no more than this many characters is taken over the exact middle. */
const BREAK_SKEW = 6;

/** Where a name breaks naturally: after a separator or a space, between lower and upper case, between letters and digits. */
function breakPoints(name: string): number[] {
  const out: number[] = [];
  for (let i = 1; i < name.length; i++) {
    const a = name.charAt(i - 1);
    const b = name.charAt(i);
    const separator = /[\s._-]/.test(a);
    const camel = /[a-z]/.test(a) && /[A-Z]/.test(b);
    const digits = (/[a-z]/i.test(a) && /\d/.test(b)) || (/\d/.test(a) && /[a-z]/i.test(b));
    if (separator || camel || digits) out.push(i);
  }
  return out;
}

/**
 * The lines of an app's name in a cell that has room for two, `widthPx` wide. A name that fits on one line stays on
 * one. One that does not is split in the middle, at a natural break close to it when there is one (`fluxapp` over
 * `1186`), and never leaving a stub of a character or two for the second line: that is what a browser's own wrapping
 * does to a name with no space in it (`fluxapp118` over `6`). A name too long even for two lines keeps its start on the
 * first and its end after an ellipsis on the second, where the names of a family differ. Every line fits `widthPx` as
 * `measure` sees it, so none is cut by the cell.
 */
export function nameLines(
  name: string,
  widthPx: number,
  measure: Measure = estimateWidth,
): [string] | [string, string] {
  const fits = (text: string): boolean => measure(text) <= widthPx;
  if (fits(name)) return [name];
  const n = name.length;
  const breaks = new Set(breakPoints(name));
  const shortest = Math.max(MIN_LINE, Math.floor(n / 3));
  let even = -1;
  let evenOff = Number.POSITIVE_INFINITY;
  let natural = -1;
  let naturalOff = Number.POSITIVE_INFINITY;
  for (let i = MIN_LINE; i <= n - MIN_LINE; i++) {
    const first = name.slice(0, i).trimEnd();
    const second = name.slice(i).trimStart();
    // Both lines must fit, and neither may be a stub.
    if (first.length < MIN_LINE || second.length < MIN_LINE || !fits(first) || !fits(second)) continue;
    const off = Math.abs(first.length - second.length);
    if (off <= evenOff) {
      even = i;
      evenOff = off;
    }
    if (
      breaks.has(i) &&
      first.length >= shortest &&
      second.length >= shortest &&
      off <= BREAK_SKEW &&
      off < naturalOff
    ) {
      natural = i;
      naturalOff = off;
    }
  }
  const at = natural >= 0 ? natural : even;
  if (at >= 0) return [name.slice(0, at).trimEnd(), name.slice(at).trimStart()];
  // Too long for two lines: the start of the name, then an ellipsis and the end of it.
  let h = n;
  while (h > 1 && !fits(name.slice(0, h).trimEnd())) h--;
  const head = [...breaks].filter((i) => i <= h && i >= h - 3).pop() ?? h;
  let t = 0;
  while (t < n - head && fits(`…${name.slice(n - t - 1)}`)) t++;
  return [name.slice(0, head).trimEnd(), `…${name.slice(n - t).trimStart()}`];
}

/** A footprint as a percentage with the digits that mean something at its size: `1.2%`, `0.31%`, `<0.01%`. */
export function footprintText(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  if (share < 0.0001) return '<0.01%';
  if (share < 0.01) return formatPercent(share, 2);
  return formatPercent(share, 1);
}

/** The value a cell or a list row shows for `by`. */
export function valueText(r: AppRank, by: RankBy): string {
  return by === 'instances'
    ? formatInt(r.instances)
    : r.footprint
      ? footprintText(r.footprint.share)
      : 'Unknown';
}

/** What the app's running instances lock, in words: `101 cores, 69 GB memory, 303 GB storage`; null when private. */
export function lockedText(r: AppRank): string | null {
  if (!r.locked) return null;
  return [
    formatCapacity('cpu', r.locked.cores),
    `${formatCapacity('ram', r.locked.ram_gb)} memory`,
    `${formatCapacity('ssd', r.locked.ssd_gb)} storage`,
  ].join(', ');
}

/** The lines of a cell's tooltip, after the app's name. */
export function cellFacts(r: AppRank, totalInstances: number): string[] {
  const share = totalInstances > 0 ? ` (${formatPercent(r.instances / totalInstances, 1)} of all)` : '';
  const running =
    r.target > r.instances
      ? `${formatInt(r.instances)} of ${formatInt(r.target)} instances running${share}`
      : `${formatInt(r.instances)} ${r.instances === 1 ? 'instance' : 'instances'} running${share}`;
  const locked = lockedText(r);
  return [
    running,
    locked
      ? `Locks ${locked}`
      : r.enterprise
        ? 'Enterprise app: its size is private'
        : 'Its size on the network is not known',
  ];
}

/** The caption under the picture: what area means, how many apps are drawn, and what was left out. */
export function mapCaption(ranked: readonly AppRank[], by: RankBy, drawn: number, leftOut: number): string {
  const parts = [
    by === 'instances'
      ? 'Area is the number of instances running.'
      : "Area is the average of the app's share of the network's CPU, memory and storage.",
  ];
  if (drawn > 0 && drawn < ranked.length) {
    parts.push(`The ${formatInt(drawn)} biggest apps are drawn to scale against each other.`);
  }
  if (by === 'footprint' && leftOut > 0) {
    parts.push(
      `${formatInt(leftOut)} enterprise ${leftOut === 1 ? 'app keeps its' : 'apps keep their'} size private and ${leftOut === 1 ? 'is' : 'are'} left out.`,
    );
  }
  return parts.join(' ');
}
