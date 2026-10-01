// The terminal's scrollback: a small external store at module level, so closing and reopening the
// terminal window (it rides in `?w=terminal`) keeps what was on screen, and a running stream's output
// survives a re-render. Capped, so a long `tail` never grows without bound.

import type { LineKind, OutLine, Span } from './output';

export const SCROLLBACK_MAX = 600;

let lines: OutLine[] = [];
let nextId = 1;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version++;
  for (const l of listeners) l();
}

export const scrollback = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  get(): readonly OutLine[] {
    return lines;
  },
  version(): number {
    return version;
  },
  push(kind: LineKind, spans: Span[]): number {
    const id = nextId++;
    lines = [...lines, { id, kind, spans }];
    if (lines.length > SCROLLBACK_MAX) lines = lines.slice(lines.length - SCROLLBACK_MAX);
    emit();
    return id;
  },
  /** Several lines at once (one notification). */
  pushMany(kind: LineKind, many: Span[][]): void {
    if (many.length === 0) return;
    const add = many.map((spans) => ({ id: nextId++, kind, spans }));
    lines = [...lines, ...add];
    if (lines.length > SCROLLBACK_MAX) lines = lines.slice(lines.length - SCROLLBACK_MAX);
    emit();
  },
  clear(): void {
    lines = [];
    emit();
  },
};
