// <Settle value={n}>: wraps a value and lets it land with a short glow whenever `value` changes.
// Never on mount, never faster than once per 1.1 s per element, never wider than the text it wraps.

import { type ElementType, type ReactNode, useRef } from 'react';
import { type UseSettleOptions, useSettle } from './hooks';

export interface SettleProps extends UseSettleOptions {
  value: unknown;
  /** The element to render (default span). Table cells and definition values work too. */
  as?: 'span' | 'div' | 'td' | 'dd' | 'strong' | 'b' | 'output';
  className?: string;
  children?: ReactNode;
}

export function Settle({ value, as = 'span', className, children, ...opts }: SettleProps) {
  const ref = useRef<HTMLElement>(null);
  useSettle(ref, value, opts);
  const Tag = as as ElementType;
  return (
    <Tag ref={ref} className={className}>
      {children ?? String(value)}
    </Tag>
  );
}
