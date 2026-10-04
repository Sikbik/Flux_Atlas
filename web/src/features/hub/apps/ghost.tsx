// The loading state of a part of the Apps hub whose content is a list, a chart or a few figures: the real markup filled
// with made-up numbers (lib/placeholders.ts) and drawn as blocks of the loading gray, so it has exactly the geometry of
// the loaded content at every width and nothing under it moves when the answer lands. Nothing in it can be reached,
// read or pointed at. The same idea as the Nodes hub's Redact.
//
// A part that is waiting for the server to read the network for the first time says so in its heading (`WaitAside`),
// where it takes no room from the body.

import { History } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../../ui';
import './ghost.css';

export interface GhostProps {
  children: ReactNode;
  className?: string;
  /** `span` where the ghost sits in a line of text (the sentence under the hero's figure). */
  as?: 'div' | 'span';
}

export function Ghost({ children, className, as: Tag = 'div' }: GhostProps) {
  return (
    <Tag className={cx('ap-ghost', className)} aria-hidden="true" inert>
      {children}
    </Tag>
  );
}

/**
 * What a heading says while the endpoint answers "wait": the server is reading the network for the first time. A
 * wait, not an error. The words on screen are short; the sentence is for assistive technology.
 */
export function WaitAside({ what }: { what: string }) {
  return (
    <span className="ap-waiting" role="status">
      <History size={13} strokeWidth={1.5} aria-hidden="true" />
      <span aria-hidden="true">Reading the network</span>
      <span className="ui-sr-only">{`The server is reading the network for the first time. ${what} appear on their own.`}</span>
    </span>
  );
}
