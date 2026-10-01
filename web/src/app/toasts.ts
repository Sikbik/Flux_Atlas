// Toasts: a small shared contract. Anyone pushes (achievements, watch alerts, errors); the frame
// renders the stack and owns its look, timing and motion. A toast is never the only place a fact
// appears: each one links to where its subject lives.

import type { ComponentType } from 'react';
import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'error' | 'achievement' | 'watch';

export interface Toast {
  id: number;
  kind: ToastKind;
  /** Pushing a toast with the key of one already queued or on screen refreshes that one instead of stacking another. */
  key?: string;
  title: string;
  body?: string;
  /** Route opened when the toast is clicked, for example `/node/1.2.3.4:16127`. */
  to?: string;
  /** Icon component from the icon set (lucide). */
  icon?: ComponentType<{ size?: number }>;
  /** Auto-dismiss after this many ms; 0 keeps the toast until it is dismissed. */
  ttlMs: number;
  createdMs: number;
}

export type ToastInput = Omit<Toast, 'id' | 'createdMs' | 'ttlMs'> & { ttlMs?: number };

interface ToastState {
  toasts: Toast[];
  push(t: ToastInput): number;
  dismiss(id: number): void;
}

const MAX_TOASTS = 5;
/** Design 6.4 H: five seconds, seven for an achievement (a longer sentence that teaches). */
const DEFAULT_TTL_MS = 5000;
const ACHIEVEMENT_TTL_MS = 7000;
let nextId = 1;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  push(t) {
    const ttlMs = t.ttlMs ?? (t.kind === 'achievement' ? ACHIEVEMENT_TTL_MS : DEFAULT_TTL_MS);
    const known = t.key === undefined ? undefined : get().toasts.find((x) => x.key === t.key);
    if (known) {
      const refreshed: Toast = { ...t, id: known.id, ttlMs, createdMs: Date.now() };
      set((s) => ({ toasts: s.toasts.map((x) => (x.id === known.id ? refreshed : x)) }));
      return known.id;
    }
    const id = nextId++;
    const next: Toast = { ...t, id, ttlMs, createdMs: Date.now() };
    set((s) => ({ toasts: [...s.toasts, next].slice(-MAX_TOASTS) }));
    return id;
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },
}));

/** Pushes a toast and returns its id. */
export const toast = (t: ToastInput): number => useToasts.getState().push(t);
