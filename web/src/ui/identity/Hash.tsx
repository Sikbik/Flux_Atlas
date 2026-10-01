import { CopyButton } from '../controls/CopyButton';
import { cx } from '../internal/cx';
import { splitHash } from './hashParts';
import { Unknown } from './Unknown';
import './identity.css';

export interface HashProps {
  /** The full value: a block or transaction hash, a collateral outpoint, an address. */
  value: string | null | undefined;
  /** Characters kept at the start (default 6). */
  head?: number;
  /** Characters kept at the end (default 5). */
  tail?: number;
  /** Show the whole value, wrapping as needed (detail panes). */
  full?: boolean;
  /** Copy button: revealed on hover and focus (`hover`, default), always visible, or off. Always visible on touch. */
  copy?: false | 'hover' | 'always';
  /** What the value is, for the copy button's accessible name ("transaction id"). */
  what?: string;
  className?: string;
}

/**
 * A long identifier, middle-truncated in Plex Mono (`8aa973…1beec`) with the full value on hover, in
 * the DOM for selection (a drag-select copies the whole hash) and one click away from the clipboard.
 */
export function Hash({ value, head = 6, tail = 5, full, copy = 'hover', what, className }: HashProps) {
  if (!value) return <Unknown />;
  const parts = full ? null : splitHash(value, head, tail);
  return (
    <span
      className={cx('ui-hash ui-mono', className)}
      data-full={full || undefined}
      data-copy={copy || undefined}
    >
      <span className="ui-hash__text" title={parts ? value : undefined}>
        {parts ? (
          <>
            {parts.head}
            <span className="ui-hash__gap" aria-hidden="true" />
            <span className="ui-hash__mid">{parts.mid}</span>
            {parts.tail}
          </>
        ) : (
          value
        )}
      </span>
      {copy ? <CopyButton value={value} what={what} className="ui-hash__copy" /> : null}
    </span>
  );
}
