// Tab completion, the ghost suffix and "did you mean". Pure functions over the typed line and the command
// registry: the view calls them and renders the result.
//
// Tab behaves like a shell with a friendlier second step: the first Tab completes as far as every
// candidate agrees; when several remain they are listed (up to 8 are shown) so a tap or the next letter
// picks one.

import { COMMANDS, findCommand, PUBLIC_NAMES } from './commands';
import { suggest } from './history';
import { commonPrefix, tokenize } from './parse';
import type { CmdEnv } from './types';

export interface Completion {
  /** The line after completing (the same line when nothing could be added). */
  line: string;
  /** Candidates to list when several remain, in the order to show. */
  candidates: string[];
}

/** Index where the word being typed starts (the line's length when it ends in a space). */
export function wordStart(line: string): number {
  let quote: string | null = null;
  let start = 0;
  let inWord = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (!inWord) start = i;
      inWord = true;
      quote = ch;
    } else if (/\s/.test(ch)) {
      inWord = false;
      start = i + 1;
    } else if (!inWord) {
      inWord = true;
      start = i;
    }
  }
  return inWord ? start : line.length;
}

const needsQuotes = (s: string): boolean => /\s/.test(s);
const quoted = (s: string): string => (needsQuotes(s) ? `"${s}"` : s);

/** Completes the line at its end. */
export function complete(line: string, env: CmdEnv): Completion {
  const t = tokenize(line);
  const typing = !t.trailingSpace && t.words.length > 0;

  // The command name.
  if (t.words.length === 0 || (t.words.length === 1 && typing)) {
    const word = (t.words[0] ?? '').toLowerCase();
    const matches = PUBLIC_NAMES.filter((n) => n.startsWith(word)).sort();
    if (matches.length === 0) return { line, candidates: [] };
    if (matches.length === 1) return { line: `${matches[0]} `, candidates: [] };
    const prefix = commonPrefix(matches);
    const next = prefix.length > word.length ? prefix : (t.words[0] ?? '');
    return { line: line.slice(0, wordStart(line)) + next, candidates: matches };
  }

  // An argument.
  const cmd = findCommand(t.words[0] ?? '');
  if (!cmd?.complete) return { line, candidates: [] };
  const partial = typing ? (t.words[t.words.length - 1] ?? '') : '';
  const before = t.words.slice(1, typing ? -1 : undefined);
  const seen = new Set<string>();
  const options = cmd.complete(before, partial, env).filter((o) => {
    const k = o.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (options.length === 0) return { line, candidates: [] };
  const head = line.slice(0, wordStart(line));
  if (options.length === 1) return { line: `${head}${quoted(options[0]!)} `, candidates: [] };
  const prefix = commonPrefix(options);
  const next = prefix.length > partial.length ? prefix : partial;
  return { line: head + (next ? quoted(next) : ''), candidates: options };
}

/** The dim suffix shown after the caret: the newest history line that continues the text, else the one command it names. */
export function ghostFor(line: string, history: readonly string[]): string {
  if (!line.trim()) return '';
  const fromHistory = suggest(history, line);
  if (fromHistory) return fromHistory.slice(line.length);
  const t = tokenize(line);
  if (t.words.length === 1 && !t.trailingSpace) {
    const word = (t.words[0] ?? '').toLowerCase();
    const matches = PUBLIC_NAMES.filter((n) => n.startsWith(word));
    if (matches.length === 1 && matches[0] !== word) return matches[0]!.slice(word.length);
  }
  return '';
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_v, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j]!;
      prev[j] = Math.min(up + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length]!;
}

/** The command a mistyped name most likely meant, or null when nothing is close. */
export function nearest(name: string): string | null {
  const word = name.toLowerCase();
  if (word.length < 2) return null;
  let best: string | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of COMMANDS) {
    if (c.level === 'hidden') continue;
    const d = c.name.startsWith(word) ? 1 : distance(word, c.name);
    if (d < bestD) {
      best = c.name;
      bestD = d;
    }
  }
  return best !== null && bestD <= (word.length <= 3 ? 1 : 2) ? best : null;
}
