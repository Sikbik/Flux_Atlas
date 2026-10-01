// Whether the boot is still running, for the frame: while it runs the chrome waits at the edges (the shell
// carries `data-boot`) and the window manager's inset must not move the globe (the boot places it). A tiny
// external store, not React state: the boot's frames never re-render anything.

import { useSyncExternalStore } from 'react';

export type BootPhase = 'running' | 'done';

let phase: BootPhase = 'running';
/** True when the chrome should appear at once instead of assembling from the edges. */
let instant = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const fn of [...listeners]) fn();
};

export const bootPhase = (): BootPhase => phase;
export const bootInstant = (): boolean => instant;
export const isBooting = (): boolean => phase === 'running';

export function finishBoot(opts: { instant?: boolean } = {}): void {
  if (phase === 'done') return;
  phase = 'done';
  instant = opts.instant === true;
  emit();
}

export const subscribeBoot = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** `running`, then `done`; the shell's `data-boot`. */
export const useBootPhase = (): BootPhase => useSyncExternalStore(subscribeBoot, bootPhase, bootPhase);

/** Test hook: back to the start. */
export function resetBootForTests(): void {
  phase = 'running';
  instant = false;
  listeners.clear();
}
