// Command history: what was run, newest last, kept in this browser. Up and Down walk it, and the most
// recent line that starts with what is typed is offered as a ghost completion.

const KEY = 'atlas.terminal.history.v1';
export const HISTORY_MAX = 100;

export function loadHistory(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function store(list: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: history lasts for the session only.
  }
}

/** Adds a line (consecutive repeats are dropped) and returns the new list. */
export function pushHistory(list: readonly string[], line: string): string[] {
  const t = line.trim();
  if (!t) return [...list];
  const next = list[list.length - 1] === t ? [...list] : [...list, t];
  const cut = next.slice(-HISTORY_MAX);
  store(cut);
  return cut;
}

export function clearHistory(): void {
  store([]);
}

/** The newest history line that starts with `typed` and is longer, or null. */
export function suggest(list: readonly string[], typed: string): string | null {
  if (!typed) return null;
  const lower = typed.toLowerCase();
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i]!;
    if (h.length > typed.length && h.toLowerCase().startsWith(lower)) return h;
  }
  return null;
}
