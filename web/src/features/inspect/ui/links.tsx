// Entity links: everything an inspector names is a link to its own window, keeping the rest of the
// URL (layers, filters, extra windows) so opening a neighbour never loses the user's place.

import { Link } from '@tanstack/react-router';
import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';

interface LinkProps {
  children: ReactNode;
  className?: string;
  title?: string;
  /** Opens the target as the primary window and keeps this window beside it (`?w=`). */
  beside?: string;
  'aria-label'?: string;
  style?: CSSProperties;
  [data: `data-${string}`]: string | boolean | undefined;
}

const search = (beside: string | undefined) =>
  beside ? (prev: Record<string, unknown>) => ({ ...prev, w: beside }) : true;

export function NodeLink({
  nodeKey,
  children,
  className,
  title,
  beside,
  ...aria
}: LinkProps & { nodeKey: string | number }) {
  return (
    <Link
      to="/node/$key"
      params={{ key: String(nodeKey) }}
      search={search(beside) as never}
      className={cx('ix-link', className)}
      title={title}
      {...aria}
    >
      {children}
    </Link>
  );
}

export function HostLink({ ip, children, className, title, beside, ...aria }: LinkProps & { ip: string }) {
  return (
    <Link
      to="/host/$ip"
      params={{ ip }}
      search={search(beside) as never}
      className={cx('ix-link', className)}
      title={title}
      {...aria}
    >
      {children}
    </Link>
  );
}

export function AppLink({ name, children, className, title, beside, ...aria }: LinkProps & { name: string }) {
  return (
    <Link
      to="/app/$name"
      params={{ name }}
      search={search(beside) as never}
      className={cx('ix-link', className)}
      title={title}
      {...aria}
    >
      {children}
    </Link>
  );
}

export function OperatorLink({
  addr,
  children,
  className,
  title,
  beside,
  ...aria
}: LinkProps & { addr: string }) {
  return (
    <Link
      to="/operator/$addr"
      params={{ addr }}
      search={search(beside) as never}
      className={cx('ix-link', className)}
      title={title}
      {...aria}
    >
      {children}
    </Link>
  );
}

export function BlockLink({ height, children, className, title, ...aria }: LinkProps & { height: number }) {
  return (
    <Link
      to="/block/$key"
      params={{ key: String(height) }}
      search={true as never}
      className={cx('ix-link', className)}
      title={title}
      {...aria}
    >
      {children}
    </Link>
  );
}

export function AddressLink({ addr, children, className, title, ...aria }: LinkProps & { addr: string }) {
  return (
    <Link
      to="/address/$addr"
      params={{ addr }}
      search={true as never}
      className={cx('ix-link', className)}
      title={title}
      {...aria}
    >
      {children}
    </Link>
  );
}

/** A link to any path of the app (for the few places that build a route by hand). */
export function PathLink({
  to,
  children,
  className,
  title,
  ...aria
}: LinkProps & { to: '/queue' | '/weather' | '/analytics' | '/mempool' | '/supply' | '/settings' }) {
  return (
    <Link to={to} search={true as never} className={cx('ix-link', className)} title={title} {...aria}>
      {children}
    </Link>
  );
}
