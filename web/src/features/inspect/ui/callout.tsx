import { TriangleAlert } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../../../ui';
import type { Tone } from '../derive/nodeState';
import './parts.css';

/**
 * A banner for the one thing worth interrupting for: an icon in a status-coloured tile, a bold lead line
 * and a sentence, with an optional action row. The UI kit has no callout, so this is local; it follows
 * the kit's status roles (`data-status` remaps `--status`) and is never the only carrier of state: the
 * lead line says it in words.
 */
export function Callout({
  tone,
  title,
  icon,
  actions,
  role = 'status',
  className,
  children,
  ...rest
}: Omit<ComponentPropsWithRef<'div'>, 'title' | 'role'> & {
  tone: Tone;
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <div {...rest} className={cx('ix-callout', className)} data-status={tone} role={role}>
      <span className="ix-callout-i" aria-hidden="true">
        {icon ?? <TriangleAlert size={16} strokeWidth={1.5} />}
      </span>
      <div className="ix-callout-t">
        <b>{title}</b>
        {children ? <span>{children}</span> : null}
        {actions ? <span className="ix-callout-a">{actions}</span> : null}
      </div>
    </div>
  );
}
