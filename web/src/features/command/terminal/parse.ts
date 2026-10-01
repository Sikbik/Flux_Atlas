// Reading a command line: words split on spaces, with single or double quotes keeping a phrase
// together (`app "Bitcoin Whitepaper"`), and the position of the word under the cursor for completion.

export interface Tokens {
  /** The words, quotes removed. */
  words: string[];
  /** True when the line ends in whitespace (a new word is about to start). */
  trailingSpace: boolean;
}

export function tokenize(line: string): Tokens {
  const words: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) words.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has || cur) words.push(cur);
  return { words, trailingSpace: /\s$/.test(line) && !quote };
}

/** The command name and its arguments, lower-casing the name. */
export function splitCommand(line: string): { name: string; args: string[]; rest: string } {
  const t = tokenize(line.trim());
  const name = (t.words[0] ?? '').toLowerCase();
  const args = t.words.slice(1);
  const rest = line
    .trim()
    .slice(line.trim().indexOf(t.words[0] ?? '') + (t.words[0]?.length ?? 0))
    .trim();
  return { name, args, rest };
}

/** The longest common prefix of the strings (case-insensitive match, first string's casing). */
export function commonPrefix(list: readonly string[]): string {
  if (list.length === 0) return '';
  let p = list[0]!;
  for (const s of list) {
    let i = 0;
    while (i < p.length && i < s.length && p[i]!.toLowerCase() === s[i]!.toLowerCase()) i++;
    p = p.slice(0, i);
    if (!p) break;
  }
  return p;
}
