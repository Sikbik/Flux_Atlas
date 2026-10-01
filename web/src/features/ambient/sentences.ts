// The words ambient mode puts on screen. The engine's director says what it is showing (an
// `AmbientCaption`); this turns that into at most two short lines. A landing becomes the one Lora sentence
// of the view ("Block 2,997,846 came from Reston. Paid to Helsinki, Raleigh and Taganrog."), the other
// scenes become a small label and a line under it. Pure, so each rule is a test.

import type { NetworkSummary } from '../../api/generated/NetworkSummary';
import type { AmbientCaption } from '../../globe/engine/types';
import { formatInt } from '../../lib/format';

/** `A`, `A and B`, `A, B and C`. */
export function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export interface CaptionText {
  /** `sentence` is a landing (set in Lora); `scene` is any other shot (a small label). */
  kind: 'sentence' | 'scene';
  lead: string;
  sub: string | null;
}

/** Names in reading order (the largest payout first, as every list in Atlas reads), each place once. */
export function payeePlaces(payees: AmbientCaption['payees'], fallback: readonly string[] = []): string[] {
  const ordered = payees
    ? [...payees].sort((a, b) => b.tier - a.tier || b.amount - a.amount).map((p) => p.name)
    : [...fallback];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of ordered) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function networkNow(s: NetworkSummary | null): string | null {
  if (!s) return null;
  return `${formatInt(s.node_count)} nodes, ${formatInt(s.app_count)} apps, ${formatInt(s.country_count)} countries`;
}

export function captionText(c: AmbientCaption, summary: NetworkSummary | null): CaptionText {
  if (c.kind === 'block') {
    const height = c.height !== undefined ? formatInt(c.height) : c.title.replace(/^Block\s+/, '');
    const places = payeePlaces(c.payees, c.payeeNames);
    return {
      kind: 'sentence',
      lead: c.producerName ? `Block ${height} came from ${c.producerName}.` : `Block ${height} is in.`,
      sub: places.length > 0 ? `Paid to ${listJoin(places)}.` : null,
    };
  }
  if (c.kind === 'stats') return { kind: 'scene', lead: c.title, sub: networkNow(summary) };
  return { kind: 'scene', lead: c.title, sub: c.subtitle ?? null };
}

/** How long a caption stays up: its own duration, but never so long that the picture is left alone with it. */
export function captionHoldMs(c: AmbientCaption): number {
  return Math.max(3, Math.min(c.duration, 9)) * 1000;
}
