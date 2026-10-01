// What the concentration headlines say: who the leaders are, how many it takes to pass half of the
// network, and how to name them in a sentence.

/**
 * The bars outside the leading set step back to the neutral gray (the kit's "Other" colour), so the
 * coloured bars read as the few entities that together pass half of the network.
 */
export const REST_COLOR = 'var(--viz-other)';

/** The label column of a ranked bar list: up to 150 px, a third of the width on a phone. */
export const BAR_LABEL_COLUMN = 'min(150px, 32%)';

/**
 * A node share (a fraction) as a percentage. A share too small for one decimal reads "<0.1%": three
 * nodes out of thousands are not zero, and a bar row that says 0.0% next to a count of 3 looks wrong.
 */
export function shareText(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction < 0) return '';
  if (fraction > 0 && fraction < 0.001) return '<0.1%';
  return `${(fraction * 100).toFixed(1)}%`;
}

export interface Counted {
  key: string;
  label: string;
  count: number;
}

export interface Leaders<T extends Counted> {
  /** The smallest set that holds more than `threshold` of the total, biggest first. */
  leaders: T[];
  /** How many entities that is (the Nakamoto coefficient for this grouping). */
  n: number;
  /** What the leaders hold together, as a fraction of `total`. */
  share: number;
  /** False when even every listed entity together does not pass the threshold. */
  reached: boolean;
}

/**
 * The leaders of a grouping. `total` is the whole network (so nodes with no country or provider still
 * count against the leaders), which can exceed the sum of the listed entities.
 */
export function leaders<T extends Counted>(items: readonly T[], total: number, threshold = 0.5): Leaders<T> {
  const sorted = [...items].sort((a, b) => b.count - a.count);
  const out: T[] = [];
  let acc = 0;
  for (const it of sorted) {
    out.push(it);
    acc += it.count;
    if (total > 0 && acc / total > threshold) {
      return { leaders: out, n: out.length, share: acc / total, reached: true };
    }
  }
  return { leaders: out, n: out.length, share: total > 0 ? acc / total : 0, reached: false };
}

/** "Germany", "Germany and Finland", "Germany, Finland and France", "Germany, Finland and 3 others". */
export function nameList(names: readonly string[], max = 3): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const rest = names.length - (max - 1);
  return `${names.slice(0, max - 1).join(', ')} and ${rest} others`;
}
