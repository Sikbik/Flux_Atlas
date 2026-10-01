// Text matching for the palette: a score (0 means no match) and the segments to highlight. Plain
// functions over strings, so the palette, the results page and the terminal's completion share them.

const WORD_BOUNDARY = /[\s./_:,-]/;

function atWordStart(text: string, i: number): boolean {
  return i === 0 || WORD_BOUNDARY.test(text[i - 1] ?? '');
}

/** Levenshtein distance with an early exit above `max` (null when it is larger). */
export function editDistance(a: string, b: string, max: number): number | null {
  if (Math.abs(a.length - b.length) > max) return null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    cur[0] = i + 1;
    let rowMin = cur[0];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      cur[j + 1] = Math.min((prev[j] ?? 0) + cost, (prev[j + 1] ?? 0) + 1, (cur[j] ?? 0) + 1);
      rowMin = Math.min(rowMin, cur[j + 1] ?? 0);
    }
    if (rowMin > max) return null;
    [prev, cur] = [cur, prev];
  }
  const d = prev[b.length] ?? max + 1;
  return d <= max ? d : null;
}

/** True when every character of `q` appears in `text` in order. */
function isSubsequence(q: string, text: string): boolean {
  let at = 0;
  for (const ch of q) {
    at = text.indexOf(ch, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

export interface MatchOptions {
  /** Allow a typo or two (apps and places); off for identifiers. */
  fuzzy?: boolean;
}

/**
 * How well `query` matches `text`, 0 to 100 (0: no match). Exact 100, prefix 90, a word prefix 75, a
 * substring 60 (earlier is better), letters in order 30 to 40, and with `fuzzy` a near miss 25 to 35.
 */
export function matchScore(query: string, text: string, opts: MatchOptions = {}): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 90 - Math.min(10, Math.floor((t.length - q.length) / 6));
  const at = t.indexOf(q);
  if (at >= 0) {
    if (atWordStart(t, at)) return 75 - Math.min(10, Math.floor(at / 8));
    if (q.length >= 3) return 60 - Math.min(15, Math.floor(at / 4));
  }
  if (q.length >= 3 && isSubsequence(q, t) && t.length <= q.length * 4) return 32;
  if (opts.fuzzy && q.length >= 4) {
    // Compare against each word and the whole text: "bitcoinwhitepapr" is one word, "flux ndoe" is two.
    const max = q.length >= 8 ? 2 : 1;
    let best: number | null = editDistance(q, t, max);
    for (const w of t.split(/[\s./_:,-]+/)) {
      if (w.length < 3) continue;
      const d = editDistance(q, w, max);
      if (d !== null && (best === null || d < best)) best = d;
    }
    if (best !== null) return 35 - best * 5;
  }
  return 0;
}

export interface Segment {
  text: string;
  hit: boolean;
}

/**
 * Splits `text` into segments, marking where `query` matched: the first occurrence of the whole query,
 * else each word of it. No match returns the text unmarked.
 */
export function highlight(text: string, query: string): Segment[] {
  const q = query.trim().toLowerCase();
  if (!q || !text) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const at = lower.indexOf(q);
  if (at >= 0) {
    return [
      ...(at > 0 ? [{ text: text.slice(0, at), hit: false }] : []),
      { text: text.slice(at, at + q.length), hit: true },
      ...(at + q.length < text.length ? [{ text: text.slice(at + q.length), hit: false }] : []),
    ];
  }
  const words = [...new Set(q.split(/\s+/).filter((w) => w.length >= 2))];
  if (words.length === 0) return [{ text, hit: false }];
  const marked = new Array<boolean>(text.length).fill(false);
  let any = false;
  for (const w of words) {
    let from = 0;
    for (;;) {
      const i = lower.indexOf(w, from);
      if (i < 0) break;
      for (let k = i; k < i + w.length; k++) marked[k] = true;
      any = true;
      from = i + w.length;
    }
  }
  if (!any) return [{ text, hit: false }];
  const out: Segment[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marked[i] !== marked[start]) {
      out.push({ text: text.slice(start, i), hit: marked[start] === true });
      start = i;
    }
  }
  return out;
}
