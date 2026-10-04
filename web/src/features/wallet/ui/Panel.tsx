import type { LucideIcon } from 'lucide-react';
import { type ComponentPropsWithoutRef, type ReactNode, useId } from 'react';
import { Card, cx } from '../../../ui';

export interface PanelProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title: ReactNode;
  icon?: LucideIcon;
  /** Quiet text or chips beside the title ("30 days", a count). */
  aside?: ReactNode;
  /** Controls at the right end of the heading row. */
  actions?: ReactNode;
  /** The panel hugs its content (a one-line panel) rather than filling its grid cell. */
  tone?: 'raised' | 'flat';
  padding?: 'sm' | 'md' | 'lg';
}

/**
 * A card with a heading row: the one container the wallet's tabs put an instrument in. The heading is the
 * section's accessible name, so a screen reader lists the page as its panels.
 */
export function Panel({
  title,
  icon: Icon,
  aside,
  actions,
  tone = 'raised',
  padding = 'md',
  className,
  children,
  ...rest
}: PanelProps) {
  const id = useId();
  return (
    <Card
      as="section"
      tone={tone}
      padding={padding}
      className={cx('wl-panel', className)}
      aria-labelledby={id}
      {...rest}
    >
      <div className="wl-panel__head">
        <h2 className="wl-panel__title" id={id}>
          {Icon ? <Icon size={15} strokeWidth={1.5} aria-hidden="true" /> : null}
          <span>{title}</span>
        </h2>
        {aside ? <div className="wl-panel__aside">{aside}</div> : null}
        {actions ? <div className="wl-panel__actions">{actions}</div> : null}
      </div>
      <div className="wl-panel__body">{children}</div>
    </Card>
  );
}
