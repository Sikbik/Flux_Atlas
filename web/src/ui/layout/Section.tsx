import { ChevronDown, type LucideIcon } from 'lucide-react';
import { type ComponentPropsWithRef, type ReactNode, useId } from 'react';
import { cx } from '../internal/cx';
import { useControllableState } from '../internal/useControllable';
import './Section.css';

export interface SectionProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  /** The section heading (Montserrat 600 15 px). Omit for an untitled block that only gets the divider. */
  title?: ReactNode;
  /** A glyph before the title (a lucide icon component). */
  icon?: LucideIcon;
  /** Right-aligned secondary text or chips beside the title ("updates every block", a count). */
  aside?: ReactNode;
  /** Controls at the right end of the heading row (a segmented control, a small button). */
  actions?: ReactNode;
  /** Heading level (default 2); pick the level that fits the page outline. */
  level?: 2 | 3 | 4;
  /** Let the reader fold the section; the heading becomes a button with `aria-expanded`. */
  collapsible?: boolean;
  /** Initial state of an uncontrolled collapsible section (default open). */
  defaultOpen?: boolean;
  /** Controlled open state of a collapsible section. */
  open?: boolean;
  /** Called when the reader folds or unfolds a collapsible section. */
  onOpenChange?: (open: boolean) => void;
  /** Remove the body padding so a table or chart can run edge to edge. */
  flush?: boolean;
  children?: ReactNode;
}

/**
 * A titled section of a view: hairline divider on top, a heading row with an aside and actions, then
 * the body. `collapsible` folds the body with a height transition (grid rows, no layout thrash).
 */
export function Section({
  title,
  icon: Icon,
  aside,
  actions,
  level = 2,
  collapsible,
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  flush,
  className,
  children,
  ...rest
}: SectionProps) {
  const headingId = useId();
  const bodyId = useId();
  const [open, setOpen] = useControllableState(openProp, defaultOpen, onOpenChange);
  const expanded = !collapsible || open;
  const Heading = `h${level}` as 'h2' | 'h3' | 'h4';

  const label = (
    <>
      {Icon ? <Icon className="ui-section__icon" size={15} strokeWidth={1.5} aria-hidden="true" /> : null}
      <span className="ui-section__text">{title}</span>
      {collapsible ? (
        <ChevronDown className="ui-section__chevron" size={15} strokeWidth={1.5} aria-hidden="true" />
      ) : null}
    </>
  );

  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cx('ui-section', className)}
      data-collapsible={collapsible || undefined}
      data-open={expanded}
      data-state={expanded ? 'open' : 'closed'}
      data-flush={flush || undefined}
      {...rest}
    >
      {title || aside || actions ? (
        <div className="ui-section__head">
          {title ? (
            <Heading id={headingId} className="ui-section__title">
              {collapsible ? (
                <button
                  type="button"
                  className="ui-section__toggle"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => setOpen(!open)}
                >
                  {label}
                </button>
              ) : (
                label
              )}
            </Heading>
          ) : null}
          {aside || actions ? (
            <div className="ui-section__side">
              {aside ? <span className="ui-section__aside">{aside}</span> : null}
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="ui-section__fold" id={bodyId}>
        <div className="ui-section__body" inert={!expanded}>
          {children}
        </div>
      </div>
    </section>
  );
}
