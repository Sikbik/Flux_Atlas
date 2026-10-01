// The head of an explorer view: a kind label, a hero title (a block height is set as a big numeral
// whose last group is the bright one), actions at the right, a row of chips and the full hash. A wash
// of Flux-blue light falls from the top left and a hairline of the same light closes the head.

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatSats } from '../../../lib/format';
import { cx } from './basics';
import './head.css';

/** `2997660` as `2` `,` `997` `,` `660`: the groups before the last are quiet, the last is white. */
export function Numeral({ value, className }: { value: number | string; className?: string }) {
  const text = typeof value === 'number' ? new Intl.NumberFormat('en-US').format(value) : value;
  const parts = text.split(',');
  return (
    <span className={cx('ex-numeral', className)}>
      <span className="ex-sr">{text}</span>
      <span aria-hidden="true">
        {parts.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: digit groups are positional
          <span key={i}>
            {i > 0 ? <span className="ex-numeral__sep">,</span> : null}
            <span className="ex-numeral__g" data-last={i === parts.length - 1 || undefined}>
              {p}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

/** A hero amount: the whole part in white, the fraction quiet, the unit small. */
export function HeroAmount({
  sats,
  decimals = 2,
  unit = 'FLUX',
}: {
  sats: bigint;
  decimals?: number;
  unit?: string;
}) {
  const text = formatSats(sats, { decimals, unit: false });
  const dot = text.indexOf('.');
  const whole = dot >= 0 ? text.slice(0, dot) : text;
  const frac = dot >= 0 ? text.slice(dot) : '';
  return (
    <span className="ex-hero">
      <span className="ex-hero__whole">{whole}</span>
      {frac ? <span className="ex-hero__frac">{frac}</span> : null}
      <span className="ex-hero__unit">{unit}</span>
    </span>
  );
}

export interface EntityHeadProps {
  kind: ReactNode;
  icon?: LucideIcon;
  title: ReactNode;
  /** Set the title in Plex Mono at body size (an address, a hash). */
  mono?: boolean;
  /** Controls at the right of the title (previous and next). */
  actions?: ReactNode;
  /** Freshness and live chips at the top right. */
  aside?: ReactNode;
  /** One line under the title. */
  sub?: ReactNode;
  /** Chips and gauges. */
  children?: ReactNode;
  /** The wash and hairline follow this state. */
  status?: 'ok' | 'pending' | 'warn' | 'crit' | 'off';
  loading?: boolean;
}

export function EntityHead({
  kind,
  icon: Icon,
  title,
  mono,
  actions,
  aside,
  sub,
  children,
  status,
  loading,
}: EntityHeadProps) {
  return (
    <header className="ex-head" data-status={status} data-loading={loading || undefined}>
      <div className="ex-head__top">
        <span className="ex-head__kind">
          {Icon ? <Icon size={14} strokeWidth={1.5} aria-hidden="true" /> : null}
          {kind}
        </span>
        {aside ? <div className="ex-head__aside">{aside}</div> : null}
      </div>
      <div className="ex-head__main">
        <h1 className="ex-head__title" data-mono={mono || undefined}>
          {title}
        </h1>
        {actions ? <div className="ex-head__actions">{actions}</div> : null}
      </div>
      {sub ? <div className="ex-head__sub">{sub}</div> : null}
      {children ? <div className="ex-head__meta">{children}</div> : null}
    </header>
  );
}
