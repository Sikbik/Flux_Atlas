// How a row of equal things (a hero's figures, the go-to tiles) is laid out in a window of a given width, so the last
// row never holds one thing beside a hole. Pure; the CSS reads the answers as custom properties.

/**
 * The number of columns, no more than `max`, that lays `n` things out with the fewest holes in the last row. Five
 * things are five across or three and two, never four and one; four are four across or two and two.
 */
export function balancedColumns(n: number, max: number): number {
  if (n <= 1) return 1;
  let best = 1;
  let holes = Number.POSITIVE_INFINITY;
  for (let c = Math.min(n, Math.max(1, max)); c >= 2; c--) {
    const left = Math.ceil(n / c) * c - n;
    // Strictly fewer holes wins, so of two equal layouts the wider one is kept.
    if (left < holes) {
      best = c;
      holes = left;
    }
  }
  return best;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

export interface RowPlan {
  /**
   * The columns of a grid fine enough that every row is whole columns: rows of different counts (three tiles over
   * two) share one grid, and each row still divides the full width evenly.
   */
  sub: number;
  /** For each thing, in order, how many of those columns it spans. */
  spans: number[];
}

/**
 * Rows of `columns` things, the rest in the last row, every row filling the width: three over two is a grid of six
 * where the first row's things span two and the second's span three. With `lead`, a single thing the rows cannot
 * pair (the odd one of an odd count in two columns) is the first of them rather than the last.
 */
export function rowPlan(n: number, columns: number, lead = false): RowPlan {
  if (n <= 0) return { sub: 1, spans: [] };
  const c = Math.max(1, Math.min(Math.floor(columns), n));
  const rows: number[] =
    lead && c === 2 && n % 2 === 1
      ? [1, ...Array.from({ length: (n - 1) / 2 }, () => 2)]
      : [...Array.from({ length: Math.floor(n / c) }, () => c), ...(n % c === 0 ? [] : [n % c])];
  const sub = rows.reduce((acc, r) => lcm(acc, r), 1);
  return { sub, spans: rows.flatMap((r) => Array.from({ length: r }, () => sub / r)) };
}
