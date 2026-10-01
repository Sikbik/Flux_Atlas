import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { copyText } from '../internal/clipboard';
import { cx } from '../internal/cx';
import { Tooltip } from '../overlay/Tooltip';
import './CopyButton.css';

export interface CopyButtonProps {
  /** The exact text to copy (the full hash, address or id, never the truncated form). */
  value: string;
  /** What is being copied, for the accessible name: "transaction id" gives "Copy transaction id". */
  what?: string;
  /** `sm` is a 20 px glyph button for inline use (default); `md` is 28 px. */
  size?: 'sm' | 'md';
  /** Called after a successful copy. */
  onCopied?: () => void;
  className?: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

/** An icon button that copies `value` and confirms with a check mark and a polite announcement. */
export function CopyButton({ value, what, size = 'sm', onCopied, className }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const label = what ? `Copy ${what}` : 'Copy';
  const onClick = async () => {
    const ok = await copyText(value);
    setState(ok ? 'copied' : 'failed');
    if (ok) onCopied?.();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), ok ? 1400 : 2000);
  };
  const Icon = state === 'copied' ? Check : state === 'failed' ? TriangleAlert : Copy;
  const tip = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label;

  return (
    <>
      <Tooltip content={tip} placement="top">
        <button
          type="button"
          className={cx('ui-copy', className)}
          data-size={size}
          data-state={state}
          aria-label={label}
          onClick={onClick}
        >
          <Icon size={size === 'sm' ? 13 : 15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </Tooltip>
      {/* A sibling, not a child: a button's children are presentational and would not be announced. */}
      <span className="ui-copy__live" role="status" aria-live="polite">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </>
  );
}
