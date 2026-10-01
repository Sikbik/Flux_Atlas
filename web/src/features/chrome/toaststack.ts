// The toast stack's logic, free of React (design 6.4 H, 8.17): which toasts are on screen and which wait,
// how long each has left, and which part of a sentence reads as data. At most three are stacked on a
// desktop and one on a phone; the rest wait their turn in the order they arrived, so a toast is never
// pushed out before it was seen.

import type { Toast } from '../../app/toasts';

export const STACK_MAX = 3;
export const STACK_MAX_PHONE = 1;
/** A leaving toast fades for this long before the stack closes the gap (design 8.17: exit 180 ms). */
export const EXIT_MS = 180;

export interface Entry {
  toast: Toast;
  leaving: boolean;
}

/**
 * Brings what is on screen in line with the store. A toast that left the store keeps its place while it
 * fades out; a toast still in the store takes its latest content; waiting toasts step in, oldest first,
 * while there is room (a fading toast still holds its place until it is gone).
 */
export function reconcile(entries: readonly Entry[], toasts: readonly Toast[], max: number): Entry[] {
  const live = new Map(toasts.map((t) => [t.id, t]));
  const next: Entry[] = entries.map((e) => {
    const t = live.get(e.toast.id);
    if (t) return { toast: t, leaving: false };
    return e.leaving ? e : { toast: e.toast, leaving: true };
  });
  const have = new Set(next.map((e) => e.toast.id));
  for (const t of toasts) {
    if (next.length >= max) break;
    if (!have.has(t.id)) next.push({ toast: t, leaving: false });
  }
  return next;
}

/** The stack once a fading toast is gone. */
export const removeEntry = (entries: readonly Entry[], id: number): Entry[] =>
  entries.filter((e) => e.toast.id !== id);

/** A toast's remaining life; `left` is infinite for a toast that stays until it is dismissed. */
export interface Life {
  left: number;
  /** The toast's `createdMs` when the clock started: a refreshed toast (same key) gets a fresh clock. */
  stamp: number;
}

/**
 * Runs every on-screen toast's clock forward by `dt` ms (not while the stack is paused by the pointer,
 * by focus or by a hidden tab) and returns the ids whose time is up. Waiting toasts have no clock yet.
 */
export function tick(
  lives: Map<number, Life>,
  entries: readonly Entry[],
  dt: number,
  paused: boolean,
): number[] {
  const expired: number[] = [];
  const present = new Set<number>();
  for (const { toast, leaving } of entries) {
    if (leaving) continue;
    present.add(toast.id);
    let life = lives.get(toast.id);
    if (!life || life.stamp !== toast.createdMs) {
      life = { left: toast.ttlMs > 0 ? toast.ttlMs : Number.POSITIVE_INFINITY, stamp: toast.createdMs };
      lives.set(toast.id, life);
    }
    if (paused || life.left === Number.POSITIVE_INFINITY) continue;
    life.left -= dt;
    if (life.left <= 0) expired.push(toast.id);
  }
  for (const id of [...lives.keys()]) if (!present.has(id)) lives.delete(id);
  return expired;
}

export interface Segment {
  text: string;
  /** An address or a hash: set in the mono face. */
  mono: boolean;
}

const MONO = /(\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{2,5})?\b|\b[0-9a-f]{16,}\b)/g;

/** Splits a sentence so IP addresses (with a port) and long hashes can be set in the mono face. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(MONO)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i), mono: false });
    out.push({ text: m[0], mono: true });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), mono: false });
  return out;
}

/** Errors interrupt (`alert`); everything else waits for a pause (`status`). */
export const roleOf = (kind: Toast['kind']): 'alert' | 'status' => (kind === 'error' ? 'alert' : 'status');
