import { CloudRain } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../controls/Button';
import { RelativeTime } from '../identity/RelativeTime';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { SkeletonText } from './Skeleton';
import './QueryBoundary.css';

/** The slice of a TanStack Query result that QueryBoundary reads (`useQuery` and `useInfiniteQuery` results fit). */
export interface QueryLike<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
  isFetching: boolean;
  isPlaceholderData?: boolean;
  dataUpdatedAt?: number;
}

export interface QueryBoundaryProps<T> {
  /** The query result to render. */
  query: QueryLike<T>;
  /** Renders the data once it is available. */
  children: (data: T) => ReactNode;
  /** Shown during the first load: a skeleton with the geometry of the content (default: a few text lines). */
  skeleton?: ReactNode;
  /** Decides that loaded data is empty (an empty list); then `empty` is shown instead of the children. */
  isEmpty?: (data: T) => boolean;
  /** The empty state (default: a neutral "Nothing to show"). */
  empty?: ReactNode;
  /** Tighter error and empty states for use inside cards and tables. */
  compact?: boolean;
}

/**
 * Wraps a query: a skeleton while it loads, an error with retry when it fails, an empty state when it
 * has nothing, and the data render-prop otherwise. A failed refresh keeps the last data on screen and
 * says how old it is (stale data is labelled, never silently shown as current).
 */
export function QueryBoundary<T>({
  query,
  children,
  skeleton,
  isEmpty,
  empty,
  compact,
}: QueryBoundaryProps<T>) {
  const { data } = query;
  if (data === undefined) {
    if (query.isError) {
      return (
        <ErrorState
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
          compact={compact}
        />
      );
    }
    return (
      <div className="ui-qb-loading" role="status" aria-busy="true">
        <span className="ui-sr-only">Loading</span>
        {skeleton ?? <SkeletonText lines={4} />}
      </div>
    );
  }
  if (isEmpty?.(data)) return <>{empty ?? <EmptyState compact={compact} title="Nothing to show" />}</>;
  return (
    <>
      {query.isError ? (
        <div className="ui-qb-stale" role="status">
          <CloudRain size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="ui-qb-stale__text">
            Could not refresh. Showing data from <RelativeTime ts={query.dataUpdatedAt} />.
          </span>
          <Button size="sm" variant="ghost" loading={query.isFetching} onClick={() => void query.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}
      {children(data)}
    </>
  );
}
