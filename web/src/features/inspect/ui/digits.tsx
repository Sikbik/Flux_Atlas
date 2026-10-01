import { type ReactNode, useEffect, useRef } from 'react';
import { cx } from './cx';

/**
 * A number that ticks. Every character is real text (tabular figures keep the width steady), and a
 * digit that changes enters with a short rise and fade, so a live counter reads as moving without
 * the layout ever shifting. Under reduced motion `--dur-tick` collapses and the swap is instant.
 */
export function Digits({ value, className }: { value: string; className?: string }) {
  const prev = useRef<string | null>(null);
  const before = prev.current;
  useEffect(() => {
    prev.current = value;
  });
  const chars = Array.from(value);
  const old = before === null ? null : Array.from(before);
  const n = chars.length;
  return (
    <span className={cx('ix-digits', className)}>
      {chars.map((c, i) => {
        const fromRight = n - i;
        const was = old ? old[old.length - fromRight] : undefined;
        const changed = old !== null && was !== c && c >= '0' && c <= '9';
        return (
          <span key={`${fromRight}:${c}`} className={changed ? 'ix-tick' : undefined}>
            {c}
          </span>
        );
      })}
    </span>
  );
}

/** Crossfades between two pieces of text when `k` changes (a state word, an ETA phrase). */
export function Swap({
  k,
  children,
  className,
}: {
  k: string | number;
  children: ReactNode;
  className?: string;
}) {
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
  return (
    <span key={k} className={cx(first.current ? undefined : 'ix-swap', className)}>
      {children}
    </span>
  );
}
