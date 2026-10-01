// The one link the kit's EntityLink has no kind for: the payment queues, all tiers or one tier's ring. It
// keeps the camera, layers, filters and the selection in the URL, like every entity link. The caller styles it.

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export function QueueLink({
  tier,
  children,
  className,
  title,
  'aria-label': label,
}: {
  /** One tier's ring; omit for the page of all tiers. */
  tier?: 'cumulus' | 'nimbus' | 'stratus';
  children: ReactNode;
  className?: string;
  title?: string;
  'aria-label'?: string;
}) {
  return tier ? (
    <Link
      to="/queue/$tier"
      params={{ tier }}
      search={true as never}
      className={className}
      title={title}
      aria-label={label}
    >
      {children}
    </Link>
  ) : (
    <Link
      to="/queue"
      search={true as never}
      activeOptions={{ exact: true }}
      className={className}
      title={title}
      aria-label={label}
    >
      {children}
    </Link>
  );
}
