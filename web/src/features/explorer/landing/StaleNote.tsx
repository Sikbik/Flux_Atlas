// The one quiet line a ranking wears when the server could not build a fresh one and is serving the last good copy.

import { History } from 'lucide-react';
import { RelativeTime } from '../../../ui';
import './landing.css';

export function StaleNote({ what, ts, className }: { what: string; ts: number; className?: string }) {
  return (
    <p className={className ? `ex-stale ${className}` : 'ex-stale'} role="status">
      <History size={14} strokeWidth={1.5} aria-hidden="true" />
      <span>
        The last good copy of the {what}, from <RelativeTime ts={ts} />. The server could not build a fresh
        one.
      </span>
    </p>
  );
}
