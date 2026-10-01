// Links the UI kit has no component for: a spec revision of an app (the kit's entity links have no
// "history" kind), and a link that wears the Button's look (the kit's Button is a `<button>`). Both keep
// the camera, layers and filters in the URL, like every entity link.

import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../../ui';

interface HistoryTarget {
  name: string;
  /** The revision number (1-based). */
  n: number;
}

/** A text link to one revision of an app's spec, set like the kit's entity links. */
export function HistoryLink({
  name,
  n,
  className,
  children,
  ...rest
}: HistoryTarget & {
  children: ReactNode;
  className?: string;
  title?: string;
  'aria-label'?: string;
}) {
  return (
    <Link
      to="/app/$name/history/$n"
      params={{ name, n }}
      search={true as never}
      className={cx('ui-entity', className)}
      {...rest}
    >
      <span className="ui-entity__text">{children}</span>
    </Link>
  );
}

interface ButtonLook {
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  children?: ReactNode;
  className?: string;
  title?: string;
  'aria-label'?: string;
}

/** The inside of a small Button: the kit's icon sizes (14 px beside a label, 16 px alone). */
function Face({ icon: Icon, iconRight: IconRight, children }: ButtonLook) {
  const px = children ? 14 : 16;
  return (
    <>
      {Icon ? <Icon size={px} strokeWidth={1.5} aria-hidden="true" /> : null}
      {children ? <span className="ui-button__label">{children}</span> : null}
      {IconRight ? <IconRight size={px} strokeWidth={1.5} aria-hidden="true" /> : null}
    </>
  );
}

/** A link to a spec revision that looks like a small secondary Button (previous and next revision). */
export function HistoryButton({ name, n, className, ...look }: HistoryTarget & ButtonLook) {
  return (
    <Link
      to="/app/$name/history/$n"
      params={{ name, n }}
      search={true as never}
      className={cx('ui-button', 'ix-link-button', className)}
      data-variant="secondary"
      data-size="sm"
      data-icon-only={look.children ? undefined : ''}
      title={look.title ?? look['aria-label']}
      aria-label={look['aria-label']}
    >
      <Face {...look} />
    </Link>
  );
}

/** A link to another site (it opens in a new tab) that looks like a small secondary Button. */
export function ExternalButton({ href, className, ...look }: { href: string } & ButtonLook) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cx('ui-button', 'ix-link-button', className)}
      data-variant="secondary"
      data-size="sm"
      title={look.title}
      aria-label={look['aria-label']}
    >
      <Face {...look} />
    </a>
  );
}
