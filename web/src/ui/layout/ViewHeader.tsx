import type { LucideIcon } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../internal/cx';
import type { TierName } from '../internal/status';
import './ViewHeader.css';

/** Props of a ViewHeader: the slots below, plus `className`, `style`, `ref` and the other `<div>` attributes. */
export interface ViewHeaderProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'children'> {
  /** The kind of thing this view is about, in sentence case ("Node", "Transaction", "Block"). Not a tracked caps eyebrow. */
  kind?: ReactNode;
  /** A glyph before the kind label (a lucide icon component). */
  icon?: LucideIcon;
  /** The view's title: a name, an id, an endpoint. */
  title: ReactNode;
  /** Set the title in Plex Mono (IPs, hashes, heights); use for ids, not names. */
  mono?: boolean;
  /** One line under the title ("Stratus node in Helsinki, paid 1,654 blocks ago"). */
  subtitle?: ReactNode;
  /** Actions at the right (buttons, a menu trigger). */
  actions?: ReactNode;
  /** The freshness chip of this view's data, at the top right. */
  freshness?: ReactNode;
  /** Tints the underline light with the tier colour (node views wear their tier). */
  tier?: TierName;
  /** Heading level of the title (default 1). */
  level?: 1 | 2;
  /** Extra row under the subtitle: status and tier chips, links. */
  children?: ReactNode;
}

/**
 * The head of a view: a sentence-case kind label, the title, a subtitle, actions and a freshness slot,
 * over a hairline of Flux-blue light. Lays out in two columns and folds to one in a narrow window.
 * Keep it calm: one primary action at most, and put the rest in a menu. It renders a `div`, not a
 * `header`, so a window never adds a second banner landmark to the page; the title is the heading.
 */
export function ViewHeader({
  kind,
  icon: Icon,
  title,
  mono,
  subtitle,
  actions,
  freshness,
  tier,
  level = 1,
  children,
  className,
  ...rest
}: ViewHeaderProps) {
  const Heading = `h${level}` as 'h1' | 'h2';
  return (
    <div className={cx('ui-vh', className)} data-tier={tier} {...rest}>
      <div className="ui-vh__grid">
        {kind || Icon ? (
          <div className="ui-vh__kind">
            {Icon ? <Icon className="ui-vh__glyph" size={15} strokeWidth={1.5} aria-hidden="true" /> : null}
            {kind}
          </div>
        ) : null}
        {freshness ? <div className="ui-vh__aside">{freshness}</div> : null}
        <Heading className="ui-vh__title" data-mono={mono || undefined}>
          {title}
        </Heading>
        {subtitle ? <p className="ui-vh__sub">{subtitle}</p> : null}
        {actions ? <div className="ui-vh__actions">{actions}</div> : null}
        {children ? <div className="ui-vh__meta">{children}</div> : null}
      </div>
    </div>
  );
}
