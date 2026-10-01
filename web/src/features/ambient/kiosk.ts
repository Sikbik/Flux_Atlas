// A screen nobody is watching has to look after itself. While ambient mode is up, a watchdog asks a
// dropped live stream to reconnect every few seconds (the client backs off by itself, this only nudges it
// past its longest waits), and if the stream has been gone for minutes it reloads the page once, since a
// kiosk has no one to press F5. Reloads are spaced out so a dead backend cannot cause a reload loop.

import type { ConnectionStatus } from '../../store/network';

export const NUDGE_EVERY_MS = 20_000;
export const RELOAD_AFTER_MS = 5 * 60_000;
export const RELOAD_COOLDOWN_MS = 15 * 60_000;

export type WatchdogAction = 'none' | 'nudge' | 'reload';

export interface WatchdogInput {
  status: ConnectionStatus;
  /** When the stream was last seen healthy (ms), or null if it never was in this run. */
  downSinceMs: number | null;
  nowMs: number;
  /** When the last reload happened (ms), or null. */
  lastReloadMs: number | null;
}

/** What to do about the connection right now. */
export function watchdogAction({ status, downSinceMs, nowMs, lastReloadMs }: WatchdogInput): WatchdogAction {
  if (status === 'live' || status === 'syncing' || status === 'connecting' || status === 'idle')
    return 'none';
  if (downSinceMs === null) return 'nudge';
  const down = nowMs - downSinceMs;
  const recentReload = lastReloadMs !== null && nowMs - lastReloadMs < RELOAD_COOLDOWN_MS;
  if (down >= RELOAD_AFTER_MS && !recentReload) return 'reload';
  return 'nudge';
}

const RELOAD_KEY = 'atlas.kiosk.reload';

export function readLastReload(): number | null {
  try {
    const v = Number(globalThis.sessionStorage?.getItem(RELOAD_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function noteReload(nowMs: number): void {
  try {
    globalThis.sessionStorage?.setItem(RELOAD_KEY, String(nowMs));
  } catch {
    // No storage: the page still reloads; only the cooldown is lost.
  }
}

export interface WatchdogHost {
  status(): ConnectionStatus;
  nudge(): void;
  reload(): void;
  now?: () => number;
}

/** Runs the watchdog until the returned function is called. */
export function startWatchdog(host: WatchdogHost): () => void {
  const now = host.now ?? Date.now;
  let downSince: number | null = null;
  const id = window.setInterval(() => {
    const t = now();
    const status = host.status();
    if (status === 'live') downSince = null;
    else if (downSince === null) downSince = t;
    const action = watchdogAction({
      status,
      downSinceMs: downSince,
      nowMs: t,
      lastReloadMs: readLastReload(),
    });
    if (action === 'nudge') host.nudge();
    else if (action === 'reload') {
      noteReload(t);
      host.reload();
    }
  }, NUDGE_EVERY_MS);
  return () => window.clearInterval(id);
}
