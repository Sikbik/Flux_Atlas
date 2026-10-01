import { CircleAlert, TriangleAlert } from 'lucide-react';
import { type CSSProperties, type ReactNode, useId } from 'react';
import type { Tone } from '../derive/nodeState';
import { cx } from './cx';

const style = (vars: Record<string, string | number>): CSSProperties => vars as CSSProperties;

/** A titled section of a window body. `index` staggers its entrance (capped by the design at 8). */
export function Section({
  title,
  icon,
  aside,
  index = 0,
  bare,
  className,
  children,
  id,
}: {
  title: ReactNode;
  icon?: ReactNode;
  aside?: ReactNode;
  index?: number;
  /** No hairline above (the first section of a window). */
  bare?: boolean;
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  const hid = useId();
  return (
    <section
      id={id}
      className={cx('ix-sec ix-rise', className)}
      aria-labelledby={hid}
      data-bare={bare || undefined}
      style={style({ '--ix-i': index })}
    >
      <h3 className="ix-sec-h" id={hid}>
        {icon}
        {title}
        {aside ? <span className="ix-aside">{aside}</span> : null}
      </h3>
      {children}
    </section>
  );
}

export function Grid({
  cols = 2,
  children,
  className,
}: {
  cols?: 2 | 3 | 4;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('ix-grid', className)} data-cols={cols}>
      {children}
    </div>
  );
}

/** A statistic: label, value, optional unit and a mono detail line. */
export function Tile({
  label,
  icon,
  value,
  unit,
  detail,
  detailTone,
  spark,
  className,
  children,
}: {
  label: ReactNode;
  icon?: ReactNode;
  value?: ReactNode;
  unit?: ReactNode;
  detail?: ReactNode;
  detailTone?: 'up' | 'down' | 'warn' | 'accent';
  spark?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cx('ix-tile', className)}>
      <div className="ix-tile-k">
        {icon}
        {label}
      </div>
      {value !== undefined ? (
        <div className="ix-tile-v">
          {value}
          {unit ? <small>{unit}</small> : null}
        </div>
      ) : null}
      {children}
      {detail !== undefined ? (
        <div className="ix-tile-d" data-tone={detailTone}>
          {detail}
        </div>
      ) : null}
      {spark ? <div className="ix-tile-spark">{spark}</div> : null}
    </div>
  );
}

/** Label and value rows. Values are right-aligned mono unless `sans`. */
export function Kv({ children }: { children: ReactNode }) {
  return <dl className="ix-kv">{children}</dl>;
}

export function KvRow({ label, children, sans }: { label: ReactNode; children: ReactNode; sans?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd data-sans={sans || undefined}>{children}</dd>
    </>
  );
}

/** A 4 px meter. `value` is a fraction (0..1). */
export function Meter({
  value,
  kind,
  label,
  className,
}: {
  value: number | null;
  kind?: 'locked' | 'tier';
  label?: string;
  className?: string;
}) {
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  return (
    // biome-ignore lint/a11y/useSemanticElements: a styled meter; a native meter cannot take the gradient fill
    <div
      className={cx('ix-meter', className)}
      data-kind={kind}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(v * 100)}
    >
      <i style={style({ '--ix-p': v })} />
    </div>
  );
}

/** A panel with an icon, a bold lead line and a sentence (never a modal). */
export function Alert({
  tone,
  title,
  children,
  icon,
  role = 'status',
}: {
  tone: Tone;
  title: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <div className="ix-alert" data-status={tone} role={role}>
      <span className="ix-alert-i" aria-hidden="true">
        {icon ?? <TriangleAlert size={16} strokeWidth={1.75} />}
      </span>
      <div>
        <b>{title}</b>
        {children}
      </div>
    </div>
  );
}

/** Empty and error states: an icon, one sentence saying what happened, one action. */
export function State({
  icon,
  title,
  children,
  action,
  tone,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  tone?: 'warn' | 'crit';
}) {
  return (
    <div className="ix-state" data-tone={tone} role={tone === 'crit' ? 'alert' : 'status'}>
      <span className="ix-state-i" aria-hidden="true">
        {icon ?? <CircleAlert size={20} strokeWidth={1.5} />}
      </span>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/** A skeleton block with the geometry of the content it stands in for. */
export function Sk({
  w,
  h,
  r,
  className,
}: {
  w?: number | string;
  h: number | string;
  r?: number | string;
  className?: string;
}) {
  return (
    <span
      className={cx('ix-sk', className)}
      aria-hidden="true"
      style={{ width: w ?? '100%', height: h, borderRadius: r }}
    />
  );
}
