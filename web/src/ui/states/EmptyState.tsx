import { Inbox, type LucideIcon } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../internal/cx';
import './EmptyState.css';

export type StateTone = 'neutral' | 'warn' | 'error';

/** Props of an EmptyState: the content below, plus `className`, `style`, `ref` and the other `<div>` attributes. */
export interface EmptyStateProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'children'> {
  /** Icon in the tile (a lucide icon component; default Inbox). */
  icon?: LucideIcon;
  /** What happened, in one short sentence ("Nothing at that address"). */
  title: ReactNode;
  /** One or two sentences saying what to do next. */
  children?: ReactNode;
  /** The one action (a Button, usually). */
  action?: ReactNode;
  /** `neutral` (default), `warn` or `error`: tints the icon tile. */
  tone?: StateTone;
  /** Tighter padding for use inside a table or a card. */
  compact?: boolean;
  /** Draw the hexagon lattice behind the content, faded by a radial mask (never behind dense data). */
  pattern?: boolean;
  /** Draw a bordered panel around the state (errors use it with a tone-coloured border). */
  framed?: boolean;
  /** Live-region role: `alert` for errors, `status` for loading and empty notices. */
  role?: 'alert' | 'status';
}

/** The empty state: an icon, one sentence saying what happened, one action (design 8.18). */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  children,
  action,
  tone = 'neutral',
  compact,
  pattern,
  framed,
  role,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      role={role}
      className={cx('ui-state', className)}
      data-tone={tone}
      data-compact={compact || undefined}
      data-pattern={pattern || undefined}
      data-framed={framed || undefined}
      {...rest}
    >
      <span className="ui-state__icon" aria-hidden="true">
        <Icon size={20} strokeWidth={1.5} />
      </span>
      <p className="ui-state__title">{title}</p>
      {children ? <p className="ui-state__text">{children}</p> : null}
      {action ? <div className="ui-state__action">{action}</div> : null}
    </div>
  );
}
