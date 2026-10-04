// A section panel of a hub: a raised card with a heading row (icon, title, an aside and actions), a body, and a
// footer for the links that go deeper. Every panel owns its own loading, error and empty state, so one endpoint
// being down never blanks the page: the heading stays, and the body says what is missing and offers a retry.

import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { type ComponentPropsWithoutRef, type ReactNode, useId } from 'react';
import { Card, cx, EmptyState, ErrorState, Skeleton } from '../../ui';
import type { HubSpan } from './Hub';
import './hub.css';

export type PanelState = 'ready' | 'loading' | 'error' | 'empty';

export interface HubPanelProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title: ReactNode;
  icon?: LucideIcon;
  /** Quiet text at the right of the heading ("last 100 blocks"). */
  aside?: ReactNode;
  /** Controls at the right of the heading (a segmented control, a small button). */
  actions?: ReactNode;
  span?: HubSpan;
  /**
   * `row`: in a medium window, where the grid has two columns, the panel takes the whole row instead of leaving a gap
   * beside it (a third-width panel that has no partner).
   */
  fill?: 'row';
  /** Heading level (default 2: the view header's title is the page's 1). */
  level?: 2 | 3;
  state?: PanelState;
  /** The error that put the panel in its error state. */
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  /** Overrides the derived error title and explanation. */
  errorTitle?: ReactNode;
  errorText?: ReactNode;
  /** What the loading state looks like: the geometry of the content, never a spinner. */
  skeleton?: ReactNode;
  emptyIcon?: LucideIcon;
  emptyTitle?: ReactNode;
  emptyText?: ReactNode;
  emptyAction?: ReactNode;
  /** The row under the body: links that go deeper. */
  footer?: ReactNode;
  /** The body runs edge to edge (a table). */
  flush?: boolean;
  children?: ReactNode;
}

/** A section panel with its own states. */
export function HubPanel({
  title,
  icon: Icon,
  aside,
  actions,
  span = 'half',
  fill,
  level = 2,
  state = 'ready',
  error,
  onRetry,
  retrying,
  errorTitle,
  errorText,
  skeleton,
  emptyIcon = Inbox,
  emptyTitle = 'Nothing to show yet',
  emptyText,
  emptyAction,
  footer,
  flush,
  className,
  children,
  ...rest
}: HubPanelProps) {
  const headingId = useId();
  const Heading = `h${level}` as 'h2' | 'h3';
  return (
    <Card
      as="section"
      padding="none"
      className={cx('hub-panel', className)}
      data-span={span}
      data-fill={fill}
      data-state={state}
      data-flush={flush || undefined}
      aria-labelledby={headingId}
      aria-busy={state === 'loading' || undefined}
      {...rest}
    >
      <div className="hub-panel__head">
        <Heading id={headingId} className="hub-panel__title">
          {Icon ? <Icon className="hub-panel__icon" size={15} strokeWidth={1.5} aria-hidden="true" /> : null}
          <span>{title}</span>
        </Heading>
        {aside || actions ? (
          <div className="hub-panel__side">
            {aside ? <span className="hub-panel__aside">{aside}</span> : null}
            {actions}
          </div>
        ) : null}
      </div>
      <div className="hub-panel__body">
        {state === 'loading' ? (
          (skeleton ?? <Skeleton h={120} radius={10} />)
        ) : state === 'error' ? (
          <ErrorState
            compact
            framed={false}
            error={error}
            onRetry={onRetry}
            retrying={retrying}
            title={errorTitle}
          >
            {errorText}
          </ErrorState>
        ) : state === 'empty' ? (
          <EmptyState compact icon={emptyIcon} title={emptyTitle} action={emptyAction}>
            {emptyText}
          </EmptyState>
        ) : (
          children
        )}
      </div>
      {footer && state !== 'loading' ? <div className="hub-panel__foot">{footer}</div> : null}
    </Card>
  );
}
