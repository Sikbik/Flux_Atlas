// Entities as links, amounts, hashes and times. "Everything is a link": every id, address, height,
// node, app and place in the explorer opens its own window or filters the globe.

import { useLinkProps } from '@tanstack/react-router';
import { Check, Copy } from 'lucide-react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useRuntime } from '../../../app/context';
import {
  formatEndpoint,
  formatHeight,
  formatSats,
  parseFlux,
  shortAddress,
  shortCollateral,
  shortHash,
  UNKNOWN,
} from '../../../lib/format';
import { useAgo } from '../../../lib/useClock';
import { useCopy } from '../hooks/useDom';
import { cx, Unknown } from './basics';

// ---- links --------------------------------------------------------------------------------------

export type EntityKind =
  | 'node'
  | 'host'
  | 'app'
  | 'block'
  | 'tx'
  | 'address'
  | 'operator'
  | 'country'
  | 'provider'
  | 'version';

type LinkOptions = Parameters<typeof useLinkProps>[0];

const HEX64 = /^[0-9a-fA-F]{64}$/;
const OUTPOINT = /^[0-9a-fA-F]{64}:\d+$/;

export function entityLabel(kind: EntityKind, value: string): string {
  switch (kind) {
    case 'node':
      if (OUTPOINT.test(value)) return shortCollateral(value);
      return /[.[]/.test(value) ? formatEndpoint(value) : value;
    case 'host':
      return formatEndpoint(value);
    case 'block':
      if (/^\d+$/.test(value)) return formatHeight(Number(value));
      return HEX64.test(value) ? shortHash(value) : value;
    case 'tx':
      return shortHash(value);
    case 'address':
    case 'operator':
      return shortAddress(value);
    default:
      return value;
  }
}

const NOUN: Record<EntityKind, string> = {
  node: 'node',
  host: 'host',
  app: 'app',
  block: 'block',
  tx: 'transaction',
  address: 'address',
  operator: 'operator',
  country: 'country',
  provider: 'provider',
  version: 'version',
};

const isMono = (k: EntityKind) => k !== 'app' && k !== 'country' && k !== 'provider';

function target(
  kind: EntityKind,
  value: string,
): { to: string; params?: Record<string, string>; search?: Record<string, string> } {
  switch (kind) {
    case 'node':
      return { to: '/node/$key', params: { key: value } };
    case 'host':
      return { to: '/host/$ip', params: { ip: value } };
    case 'app':
      return { to: '/app/$name', params: { name: value } };
    case 'block':
      return { to: '/block/$key', params: { key: value } };
    case 'tx':
      return { to: '/tx/$txid', params: { txid: value } };
    case 'address':
      return { to: '/address/$addr', params: { addr: value } };
    case 'operator':
      return { to: '/operator/$addr', params: { addr: value } };
    // Places, providers and versions have no window: they filter the globe from wherever you are.
    case 'country':
      return { to: '.', search: { cc: value } };
    case 'provider':
      return { to: '.', search: { org: value } };
    case 'version':
      return { to: '.', search: { ver: value } };
  }
}

function Anchor({
  kind,
  value,
  children,
  ...rest
}: Omit<ComponentPropsWithoutRef<'a'>, 'href' | 'children'> & {
  kind: EntityKind;
  value: string;
  children: ReactNode;
}) {
  const t = target(kind, value);
  const opts = {
    to: t.to,
    ...(t.params ? { params: t.params } : null),
    search: (prev: Record<string, unknown>) => ({
      ...prev,
      ...(kind === 'node' || kind === 'host' ? { sel: undefined } : null),
      ...t.search,
    }),
  } as unknown as LinkOptions;
  const props = useLinkProps(opts);
  return (
    <a {...props} {...rest}>
      {children}
    </a>
  );
}

/** A round icon button that is a link (previous and next block, open in a new place). */
export function IconLink({
  kind,
  value,
  label,
  disabled,
  children,
  className,
}: {
  kind: EntityKind;
  value: string | number | null | undefined;
  label: string;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (disabled || value === null || value === undefined) {
    return (
      <span className={cx('ex-icon-btn', className)} aria-disabled="true" aria-label={label} role="img">
        {children}
      </span>
    );
  }
  return (
    <Anchor
      kind={kind}
      value={String(value)}
      className={cx('ex-icon-btn', className)}
      aria-label={label}
      title={label}
    >
      {children}
    </Anchor>
  );
}

/** A link to a window route that has no key (`/richlist`, `/mempool`, `/supply`, `/analytics`). */
export function RouteLink({
  to,
  search,
  children,
  className,
}: {
  to: string;
  search?: Record<string, unknown>;
  children: ReactNode;
  className?: string;
}) {
  const props = useLinkProps({
    to,
    search: (prev: Record<string, unknown>) => ({ ...prev, ...search }),
  } as unknown as LinkOptions);
  return (
    <a {...props} className={cx('ex-entity', className)}>
      {children}
    </a>
  );
}

export interface EntityLinkProps {
  kind: EntityKind;
  value: string | number | null | undefined;
  children?: ReactNode;
  icon?: ReactNode;
  className?: string;
  label?: string;
}

export function EntityLink({ kind, value, children, icon, className, label }: EntityLinkProps) {
  if (value === null || value === undefined || value === '') return <Unknown />;
  const key = String(value);
  const text = children ?? entityLabel(kind, key);
  const name = label ?? (typeof text === 'string' ? `Open ${NOUN[kind]} ${text}` : `Open ${NOUN[kind]}`);
  return (
    <Anchor
      kind={kind}
      value={key}
      className={cx('ex-entity', className)}
      data-kind={kind}
      data-mono={isMono(kind) || undefined}
      title={typeof text === 'string' && text !== key ? key : undefined}
      aria-label={typeof text === 'string' && text !== key ? `${name}, ${key}` : name}
    >
      {icon}
      <span>{text}</span>
    </Anchor>
  );
}

// ---- amounts ------------------------------------------------------------------------------------

export function formatAmountText(
  value: string | number | bigint | null | undefined,
  decimals = 2,
  sign: 'auto' | 'always' = 'auto',
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return formatSats(value, { decimals, sign, unit: false });
  const sats = parseFlux(value);
  return sats === null ? null : formatSats(sats, { decimals, sign, unit: false });
}

export interface AmountProps {
  value: string | number | bigint | null | undefined;
  decimals?: number;
  exact?: boolean;
  unit?: boolean | string;
  sign?: 'auto' | 'always';
  /** Dim the fraction (the integer part carries the figure; the eight decimals are precision). */
  dimFraction?: boolean;
  tone?: 'default' | 'signed' | 'hot';
  className?: string;
}

/** A FLUX amount in tabular Plex Mono. Unknown renders the word, never a zero. */
export function Amount({
  value,
  decimals,
  exact,
  unit = true,
  sign,
  dimFraction,
  tone = 'default',
  className,
}: AmountProps) {
  const text = formatAmountText(value, exact ? 8 : (decimals ?? 2), sign);
  if (text === null) return <Unknown />;
  const dot = text.indexOf('.');
  const whole = dot >= 0 ? text.slice(0, dot) : text;
  const frac = dot >= 0 ? text.slice(dot) : '';
  const negative = text.startsWith('-');
  const positive = !negative && /[1-9]/.test(text);
  const dir = tone === 'signed' ? (negative ? 'neg' : positive ? 'pos' : undefined) : undefined;
  const unitText = unit === true ? 'FLUX' : unit === false ? '' : unit;
  return (
    <span
      className={cx('ex-amount', className)}
      data-tone={tone === 'hot' ? 'hot' : undefined}
      data-dir={dir}
    >
      <span className="ex-amount__figure">
        {whole}
        {frac ? <span className={dimFraction || exact ? 'ex-amount__dim' : undefined}>{frac}</span> : null}
      </span>
      {unitText ? <span className="ex-amount__unit">{unitText}</span> : null}
    </span>
  );
}

/** A large FLUX figure for a tile: `96.48K` over 10,000, two decimals below; the exact value is the title. */
export function CompactAmount({
  value,
  unit = true,
  className,
}: {
  value: string | number | bigint | null | undefined;
  unit?: boolean | string;
  className?: string;
}) {
  const sats = typeof value === 'bigint' ? value : parseFlux(value as string | number | null | undefined);
  if (sats === null) return <Unknown />;
  const flux = Number(sats) / 1e8;
  if (Math.abs(flux) < 10_000) return <Amount value={sats} decimals={2} unit={unit} className={className} />;
  const exact = formatSats(sats, { decimals: 2 });
  const [n, s] = (() => {
    const a = Math.abs(flux);
    if (a >= 1e9) return [flux / 1e9, 'B'] as const;
    if (a >= 1e6) return [flux / 1e6, 'M'] as const;
    return [flux / 1e3, 'K'] as const;
  })();
  const text = Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
  const unitText = unit === true ? 'FLUX' : unit === false ? '' : unit;
  return (
    <span className={cx('ex-amount', className)} title={exact}>
      <span className="ex-amount__figure">
        {text}
        <span className="ex-amount__dim">{s}</span>
      </span>
      {unitText ? <span className="ex-amount__unit">{unitText}</span> : null}
    </span>
  );
}

// ---- copy and hashes ----------------------------------------------------------------------------

export function CopyButton({
  value,
  what = 'value',
  className,
}: {
  value: string;
  what?: string;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      className={cx('ex-copy', className)}
      data-copied={copied || undefined}
      aria-label={copied ? `Copied ${what}` : `Copy ${what}`}
      title={copied ? 'Copied' : `Copy ${what}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        copy(value);
      }}
    >
      {copied ? (
        <Check size={13} strokeWidth={1.8} aria-hidden="true" />
      ) : (
        <Copy size={13} strokeWidth={1.5} aria-hidden="true" />
      )}
    </button>
  );
}

export interface HashProps {
  value: string | null | undefined;
  head?: number;
  tail?: number;
  full?: boolean;
  copy?: false | 'hover' | 'always';
  what?: string;
  className?: string;
}

/** A long identifier, middle-truncated in Plex Mono; the whole value stays in the DOM for selection. */
export function Hash({ value, head = 6, tail = 5, full, copy = 'hover', what, className }: HashProps) {
  if (!value) return <Unknown />;
  const short = !full && value.length > head + tail + 1;
  return (
    <span className={cx('ex-hash', className)} data-full={full || undefined} data-copy={copy || undefined}>
      <span className="ex-hash__text" title={short ? value : undefined}>
        {short ? (
          <>
            {value.slice(0, head)}
            <span className="ex-hash__gap" aria-hidden="true" />
            <span className="ex-hash__mid">{value.slice(head, value.length - tail)}</span>
            {value.slice(value.length - tail)}
          </>
        ) : (
          value
        )}
      </span>
      {copy ? <CopyButton value={value} what={what} className="ex-hash__copy" /> : null}
    </span>
  );
}

// ---- time ---------------------------------------------------------------------------------------

/** A live "12 s ago" on the shared 1 Hz clock. The full UTC time is in the title. */
export function RelativeTime({
  ts,
  ageOnly,
  className,
}: {
  ts: number | null | undefined;
  ageOnly?: boolean;
  className?: string;
}) {
  const { clock } = useRuntime();
  const label = useAgo(clock, ts, !ageOnly);
  if (label === null || ts === null || ts === undefined) return <Unknown />;
  return (
    <time
      className={cx('ex-time', className)}
      dateTime={new Date(ts).toISOString()}
      title={new Date(ts)
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z$/, ' UTC')}
    >
      {label}
    </time>
  );
}

export { UNKNOWN };
