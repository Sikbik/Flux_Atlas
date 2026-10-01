// Small building blocks shared by every explorer, analytics and time-machine view. Prop names follow
// the UI kit's components (Section, Stat, Chip, TierChip, Skeleton, ...), so swapping them for the kit
// once it lands is a change inside this folder only.

import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  type LucideIcon,
  OctagonX,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import { type ComponentPropsWithoutRef, type CSSProperties, type ReactNode, useId, useState } from 'react';
import { UNKNOWN } from '../../../lib/format';
import './parts.css';

export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ');

export function Unknown({ className }: { className?: string }) {
  return <span className={cx('ex-unknown', className)}>{UNKNOWN}</span>;
}

// ---- sections and stats -------------------------------------------------------------------------

export interface SectionProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title?: ReactNode;
  icon?: LucideIcon;
  aside?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  flush?: boolean;
  /** Detail one step away: the heading becomes a button that folds the body. */
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export function Section({
  title,
  icon: Icon,
  aside,
  actions,
  level = 2,
  flush,
  collapsible,
  defaultOpen = true,
  className,
  children,
  ...rest
}: SectionProps) {
  const H = `h${level}` as 'h2' | 'h3';
  const [open, setOpen] = useState(defaultOpen);
  // A folded section costs nothing until it is first opened (no chart, no query), then stays mounted.
  const [opened, setOpened] = useState(defaultOpen);
  const bodyId = useId();
  const expanded = !collapsible || open;
  const label = (
    <>
      {Icon ? <Icon size={15} strokeWidth={1.5} aria-hidden="true" /> : null}
      <span>{title}</span>
      {collapsible ? (
        <ChevronDown className="ex-section__chevron" size={15} strokeWidth={1.5} aria-hidden="true" />
      ) : null}
    </>
  );
  return (
    <section
      className={cx('ex-section', className)}
      data-flush={flush || undefined}
      data-collapsible={collapsible || undefined}
      data-open={expanded}
      {...rest}
    >
      {title || aside || actions ? (
        <div className="ex-section__head">
          {title ? (
            <H className="ex-section__title">
              {collapsible ? (
                <button
                  type="button"
                  className="ex-section__toggle"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => {
                    setOpened(true);
                    setOpen((o) => !o);
                  }}
                >
                  {label}
                </button>
              ) : (
                label
              )}
            </H>
          ) : (
            <span />
          )}
          {aside || actions ? (
            <div className="ex-section__side">
              {aside ? <span className="ex-section__aside">{aside}</span> : null}
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {collapsible ? (
        <div className="ex-section__fold" id={bodyId}>
          <div className="ex-section__body" inert={!expanded}>
            {opened ? children : null}
          </div>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export interface StatProps {
  label: ReactNode;
  value?: ReactNode;
  unit?: ReactNode;
  delta?: ReactNode;
  caption?: ReactNode;
  spark?: ReactNode;
  hero?: boolean;
  loading?: boolean;
  tier?: 'cumulus' | 'nimbus' | 'stratus';
  className?: string;
}

export function Stat({
  label,
  value,
  unit,
  delta,
  caption,
  spark,
  hero,
  loading,
  tier,
  className,
}: StatProps) {
  const unknown = !loading && (value === null || value === undefined || value === '');
  return (
    <div
      className={cx('ex-stat', className)}
      data-hero={hero || undefined}
      data-tier={tier}
      aria-busy={loading || undefined}
    >
      <span className="ex-stat__label">{label}</span>
      {loading ? (
        <>
          <Skeleton w="62%" h={hero ? 36 : 24} />
          <Skeleton w="42%" h={11} />
        </>
      ) : (
        <>
          <span className="ex-stat__value">
            {unknown ? (
              <Unknown />
            ) : (
              <>
                {value}
                {unit ? <span className="ex-stat__unit">{unit}</span> : null}
              </>
            )}
          </span>
          {delta ? <span className="ex-stat__delta">{delta}</span> : null}
          {caption ? <span className="ex-stat__caption">{caption}</span> : null}
        </>
      )}
      {spark && !loading ? <span className="ex-stat__spark">{spark}</span> : null}
    </div>
  );
}

export function StatGrid({
  min = 148,
  columns,
  className,
  style,
  ...rest
}: ComponentPropsWithoutRef<'div'> & { min?: number; columns?: number }) {
  return (
    <div
      className={cx('ex-stat-grid', className)}
      data-fixed={columns ? '' : undefined}
      style={
        {
          ...style,
          ['--ex-stat-min' as string]: `${min}px`,
          ...(columns ? { ['--ex-stat-cols' as string]: columns } : null),
        } as CSSProperties
      }
      {...rest}
    />
  );
}

export interface KeyValueItem {
  id?: string;
  label: ReactNode;
  value: ReactNode | null | undefined;
  mono?: boolean;
  note?: ReactNode;
}

export function KeyValue({ items }: { items: readonly KeyValueItem[] }) {
  return (
    <dl className="ex-kv">
      {items.map((it, i) => (
        <div className="ex-kv__row" key={it.id ?? (typeof it.label === 'string' ? it.label : i)}>
          <dt>{it.label}</dt>
          <dd data-mono={it.mono || undefined}>
            {it.value === null || it.value === undefined || it.value === '' ? <Unknown /> : it.value}
            {it.note ? <span className="ex-kv__note">{it.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---- chips --------------------------------------------------------------------------------------

export interface ChipProps extends ComponentPropsWithoutRef<'span'> {
  tone?: 'neutral' | 'accent' | 'ghost';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  mono?: boolean;
}

export function Chip({
  tone = 'neutral',
  size = 'md',
  icon: Icon,
  mono,
  className,
  children,
  ...rest
}: ChipProps) {
  return (
    <span
      className={cx('ex-chip', className)}
      data-tone={tone}
      data-size={size}
      data-mono={mono || undefined}
      {...rest}
    >
      {Icon ? <Icon size={size === 'sm' ? 12 : 14} strokeWidth={1.5} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/** A chip that toggles a filter. */
export function ToggleChip({
  pressed,
  onClick,
  children,
  tier,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  tier?: TierName;
}) {
  return (
    <button type="button" className="ex-toggle" aria-pressed={pressed} data-tier={tier} onClick={onClick}>
      {tier ? <TierGlyph tier={tier} size={13} /> : null}
      {children}
    </button>
  );
}

export type TierName = 'cumulus' | 'nimbus' | 'stratus';
export const TIER_LABEL: Record<TierName, string> = {
  cumulus: 'Cumulus',
  nimbus: 'Nimbus',
  stratus: 'Stratus',
};
const LIT: Record<string, number> = { cumulus: 1, nimbus: 2, stratus: 3 };

/** The tier meter: three stacked capsules, lit bottom-up, so tier reads in greyscale too. */
export function TierGlyph({
  tier,
  size = 14,
}: {
  tier: TierName | 'unknown' | null | undefined;
  size?: number;
}) {
  const lit = LIT[tier ?? ''] ?? 0;
  return (
    <svg
      className="ex-tier-glyph"
      data-tier={tier ?? 'unknown'}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {[0, 1, 2].map((k) => (
        <rect
          key={k}
          data-lit={2 - k < lit || undefined}
          x="3"
          y={4 + k * 6.4}
          width="18"
          height="4.2"
          rx="2.1"
        />
      ))}
    </svg>
  );
}

export function TierChip({
  tier,
  label,
  size = 'md',
  ...rest
}: Omit<ChipProps, 'tone' | 'icon'> & { tier: TierName | 'unknown' | null | undefined; label?: ReactNode }) {
  const known = tier === 'cumulus' || tier === 'nimbus' || tier === 'stratus';
  return (
    <Chip size={size} data-tier={known ? tier : 'unknown'} {...rest}>
      <TierGlyph tier={tier} size={size === 'sm' ? 12 : 14} />
      {label ?? (known ? TIER_LABEL[tier] : UNKNOWN)}
    </Chip>
  );
}

const STATUS_ICON: Record<string, { icon: LucideIcon; label: string }> = {
  ok: { icon: CircleCheck, label: 'Confirmed' },
  pending: { icon: Clock, label: 'Pending' },
  warn: { icon: TriangleAlert, label: 'Warning' },
  crit: { icon: OctagonX, label: 'Error' },
  off: { icon: CircleDashed, label: UNKNOWN },
};

export function StatusChip({
  status,
  label,
  size = 'md',
  ...rest
}: Omit<ChipProps, 'tone' | 'icon'> & {
  status: 'ok' | 'pending' | 'warn' | 'crit' | 'off';
  label?: ReactNode;
}) {
  const m = STATUS_ICON[status] ?? STATUS_ICON.off!;
  const Icon = m.icon;
  return (
    <Chip size={size} data-status={status} {...rest}>
      <Icon size={size === 'sm' ? 12 : 14} strokeWidth={1.5} aria-hidden="true" />
      {label ?? m.label}
    </Chip>
  );
}

/** A quiet "Live" mark: the view follows the chain and updates by itself. */
export function LiveBadge({ label = 'Live' }: { label?: string }) {
  return (
    <span className="ex-livebadge">
      <i aria-hidden="true" />
      {label}
    </span>
  );
}

// ---- states -------------------------------------------------------------------------------------

export function Skeleton({
  w,
  h = 12,
  radius,
  circle,
  className,
  style,
  ...rest
}: Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  w?: number | string;
  h?: number | string;
  radius?: number | string;
  circle?: boolean;
}) {
  const len = (v: number | string | undefined) =>
    v === undefined ? undefined : typeof v === 'number' ? `${v}px` : v;
  const css: CSSProperties = {
    width: len(w),
    height: circle ? len(w) : len(h),
    borderRadius: circle ? '50%' : len(radius),
    ...style,
  };
  return <span aria-hidden="true" className={cx('ex-skeleton', className)} style={css} {...rest} />;
}

export function EmptyState({
  icon: Icon = CircleDashed,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="ex-empty" role="status">
      <span className="ex-empty__glyph" aria-hidden="true">
        <Icon size={22} strokeWidth={1.4} />
      </span>
      <p className="ex-empty__title">{title}</p>
      {children ? <p className="ex-empty__body">{children}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Could not load this',
  children,
  onRetry,
  offline,
}: {
  title?: ReactNode;
  children?: ReactNode;
  onRetry?: () => void;
  offline?: boolean;
}) {
  return (
    <div className="ex-empty" data-tone="error" role="alert">
      <span className="ex-empty__glyph" aria-hidden="true">
        {offline ? <WifiOff size={22} strokeWidth={1.4} /> : <CircleAlert size={22} strokeWidth={1.4} />}
      </span>
      <p className="ex-empty__title">{title}</p>
      {children ? <p className="ex-empty__body">{children}</p> : null}
      {onRetry ? (
        <button type="button" className="ex-btn" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Button({
  icon: Icon,
  children,
  className,
  ...rest
}: ComponentPropsWithoutRef<'button'> & { icon?: LucideIcon }) {
  return (
    <button type="button" className={cx('ex-btn', className)} {...rest}>
      {Icon ? <Icon size={14} strokeWidth={1.5} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
