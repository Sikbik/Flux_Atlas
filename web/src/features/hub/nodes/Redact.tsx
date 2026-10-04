// The loading state of a panel whose content is a list or a chart: the real markup filled with made-up numbers (see
// lib/placeholders.ts) and drawn as blocks of the loading gray, so it has exactly the geometry of the loaded content at
// every width. Nothing in it can be reached, read or pointed at. A panel that is waiting for the server to read the
// chain tip says so in its heading (`WaitAside`), where it takes no room from the body.

import { History } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../../ui';
import './nodes.css';

export function Redact({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('nd-redact', className)} aria-hidden="true" inert>
      {children}
    </div>
  );
}

/** What a heading says while the endpoint answers "wait": the server is reading the chain tip. A wait, not an error. */
export function WaitAside({ what }: { what: string }) {
  return (
    <span className="nd-wait" role="status">
      <History size={13} strokeWidth={1.5} aria-hidden="true" />
      <span aria-hidden="true">Reading the chain tip</span>
      <span className="ui-sr-only">{`The server is reading the chain tip. ${what} appear on their own.`}</span>
    </span>
  );
}
