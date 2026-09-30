// A minimal, neutral live status line (connection, tip, next block) until the shell's status bar
// lands. Everything here runs off the shared event clock.

import { Link } from '@tanstack/react-router';
import { formatHeight } from '../lib/format';
import { useBeat } from '../lib/useClock';
import { useConnection, useRuntime, useTip } from './context';

const LABEL: Record<string, string> = {
  idle: 'Idle',
  connecting: 'Connecting',
  syncing: 'Catching up',
  live: 'Live',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
  closed: 'Closed',
};

export function StatusLine() {
  const { clock } = useRuntime();
  const conn = useConnection();
  const tip = useTip();
  const beat = useBeat(clock);
  const retryIn = conn.retryAtMs ? Math.max(0, Math.ceil((conn.retryAtMs - Date.now()) / 1000)) : null;
  return (
    <div className="status-line" data-testid="live-status" data-status={conn.status}>
      <span className={`dot dot-${conn.status}`} aria-hidden="true" />
      <span>
        {LABEL[conn.status] ?? conn.status}
        {conn.status === 'live' && conn.transitMs !== null ? `, ${Math.round(conn.transitMs)} ms` : ''}
        {conn.status === 'reconnecting' && retryIn !== null ? ` in ${retryIn} s` : ''}
      </span>
      <span className="tabular">{tip ? `Block ${formatHeight(tip.height)}` : 'No block yet'}</span>
      <span className="tabular">
        {beat.phase === 'late' || beat.phase === 'quiet'
          ? `Block late ${Math.round(beat.sinceMs / 1000)} s`
          : beat.height !== null
            ? `Next in ${Math.ceil(beat.remainingMs / 1000)} s`
            : ''}
      </span>
      <Link to="/dev/live" className="link">
        Live inspector
      </Link>
    </div>
  );
}
