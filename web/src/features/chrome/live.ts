// What the Live chip says (design 4.4, 6.5, 8.8): the connection state in words, with the round trip
// when it is flowing. The live client already holds a reconnected stream back for two seconds before it
// reads `live`, so the chip does not flap; this maps the state to words and a tone. Pure here; the hook
// binds the store and the clock.

import { useNetwork, useRuntime } from '../../app/context';
import { useNow } from '../../lib/useClock';
import type { ConnectionState, ConnectionStatus } from '../../store/network';

export type LiveTone = 'ok' | 'pending' | 'warn' | 'crit' | 'off';

export interface LiveView {
  /** The raw connection status (the e2e hook reads it). */
  status: ConnectionStatus;
  tone: LiveTone;
  /** The state in words: `Live`, `Catching up`, `Reconnecting`, `Offline`. */
  label: string;
  /** What follows the label, in mono: `41 ms`, `in 6 s`, `upstream stale`; null when nothing. */
  detail: string | null;
}

export interface LiveInput {
  conn: Pick<ConnectionState, 'status' | 'retryAtMs' | 'transitMs'>;
  /** The server is serving restored state (upstream stale). */
  upstreamStale: boolean;
  /** Local time now (ms). */
  nowMs: number;
}

export function liveView({ conn, upstreamStale, nowMs }: LiveInput): LiveView {
  const { status } = conn;
  switch (status) {
    case 'live': {
      if (upstreamStale) return { status, tone: 'warn', label: 'Live', detail: 'upstream stale' };
      const ms = conn.transitMs === null ? null : `${Math.max(0, Math.round(conn.transitMs))} ms`;
      return { status, tone: 'ok', label: 'Live', detail: ms };
    }
    case 'syncing':
      return { status, tone: 'pending', label: 'Catching up', detail: null };
    case 'connecting':
    case 'idle':
      return { status, tone: 'pending', label: 'Connecting', detail: null };
    case 'reconnecting': {
      const secs = conn.retryAtMs === null ? null : Math.max(0, Math.ceil((conn.retryAtMs - nowMs) / 1000));
      return { status, tone: 'warn', label: 'Reconnecting', detail: secs === null ? null : `in ${secs} s` };
    }
    case 'offline':
      return { status, tone: 'crit', label: 'Offline', detail: null };
    case 'closed':
      return { status, tone: 'off', label: 'Closed', detail: null };
  }
}

/** The Live chip's view, recomputed once a second (the countdown needs it). */
export function useLiveView(): LiveView {
  const { clock } = useRuntime();
  useNow(clock);
  const conn = useNetwork((s) => s.connection);
  const stale = useNetwork((s) => s.stale);
  return liveView({ conn, upstreamStale: stale, nowMs: Date.now() });
}
