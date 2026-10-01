// What the terminal prints: lines made of styled spans. Plain data (no React), so commands can be tested
// by reading what they print, and so a line can carry links (a node, a block, an address) that open the
// real window when clicked.

import type { NavTarget } from '../navigation';

/** How a span reads: values in white, labels dim, tiers in their colour, status by word and colour. */
export type SpanStyle =
  | 'val'
  | 'dim'
  | 'key'
  | 'ok'
  | 'warn'
  | 'crit'
  | 'accent'
  | 'cumulus'
  | 'nimbus'
  | 'stratus'
  | 'cmd';

export interface Span {
  t: string;
  s?: SpanStyle;
  /** Opens a window or page when clicked (the terminal stays open). */
  to?: NavTarget;
  /** A share bar instead of text: the filled fraction, 0 to 1 (the text is its accessible label). */
  bar?: number;
}

export type LineKind = 'cmd' | 'out' | 'err' | 'hint' | 'sys';

export interface OutLine {
  id: number;
  kind: LineKind;
  spans: Span[];
}

export type SpanInput = string | Span;

export const asSpan = (x: SpanInput): Span => (typeof x === 'string' ? { t: x } : x);

export const sp = (t: string, s?: SpanStyle): Span => (s ? { t, s } : { t });
export const val = (t: string | number): Span => ({ t: String(t), s: 'val' });
export const dim = (t: string): Span => ({ t, s: 'dim' });
export const key = (t: string): Span => ({ t, s: 'key' });
export const link = (t: string, to: NavTarget, s: SpanStyle = 'val'): Span => ({ t, s, to });
export const bar = (fraction: number, label: string): Span => ({
  t: label,
  bar: Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)),
});

export const tierStyle = (tier: string): SpanStyle | undefined =>
  tier === 'cumulus' || tier === 'nimbus' || tier === 'stratus' ? tier : undefined;

/** `Stratus` in the tier's colour. */
export function tierSpan(tier: string, label?: string): Span {
  const s = tierStyle(tier);
  const name = label ?? tier[0]?.toUpperCase() + tier.slice(1);
  return s ? { t: name, s } : { t: name, s: 'dim' };
}

/** Pads a span's text to a column width (monospace alignment). */
export function pad(x: SpanInput, width: number, right = false): Span {
  const span = asSpan(x);
  const gap = Math.max(0, width - [...span.t].length);
  return { ...span, t: right ? ' '.repeat(gap) + span.t : span.t + ' '.repeat(gap) };
}

/** Spans for a row of columns separated by two spaces; each column is padded to its width. */
export function row(
  cols: readonly SpanInput[],
  widths: readonly number[],
  rightAligned: readonly number[] = [],
): Span[] {
  const out: Span[] = [];
  cols.forEach((c, i) => {
    const last = i === cols.length - 1;
    const w = widths[i] ?? 0;
    out.push(last && !rightAligned.includes(i) ? asSpan(c) : pad(c, w, rightAligned.includes(i)));
    if (!last) out.push({ t: '  ' });
  });
  return out;
}

/** The echo of a typed line after the prompt: `atlas@flux ~ node 65.109`, the command word emphasised. */
export function echoSpans(line: string): Span[] {
  const t = line.trim();
  const i = t.search(/\s/);
  const head = i < 0 ? t : t.slice(0, i);
  const tail = i < 0 ? '' : t.slice(i);
  const out: Span[] = [
    { t: 'atlas@flux', s: 'accent' },
    { t: ' ~ ', s: 'val' },
    { t: head, s: 'cmd' },
  ];
  if (tail) out.push({ t: tail });
  return out;
}

/** The plain text of a line (for copying and for tests). */
export const lineText = (spans: readonly Span[]): string => spans.map((s) => s.t).join('');
