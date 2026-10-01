import { SearchX, Server } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../../../api/http';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  QueryBoundary,
  type QueryLike,
  Row,
  Skeleton,
  SkeletonText,
  Stack,
} from '../../index';
import { GallerySection, SpecGrid, Specimen } from '../primitives';

const refetch = () => undefined;

const pending: QueryLike<string[]> = {
  data: undefined,
  isPending: true,
  isError: false,
  error: null,
  refetch,
  isFetching: true,
};
const failed: QueryLike<string[]> = {
  data: undefined,
  isPending: false,
  isError: true,
  error: new ApiError('upstream', 'upstream failed', 502, '/api/v1/nodes'),
  refetch,
  isFetching: false,
};
const stale: QueryLike<string[]> = {
  data: ['65.109.26.93:16147', '95.216.12.7:16137', '152.53.12.1:16127'],
  isPending: false,
  isError: true,
  error: new ApiError('network', 'offline', 0, '/api/v1/nodes'),
  refetch,
  isFetching: false,
  dataUpdatedAt: Date.now() - 4 * 60_000,
};
const empty: QueryLike<string[]> = {
  data: [],
  isPending: false,
  isError: false,
  error: null,
  refetch,
  isFetching: false,
};

function NodeList({ items }: { items: string[] }) {
  return (
    <Stack gap={3}>
      {items.map((ip) => (
        <div key={ip} className="ui-mono kg-line">
          {ip}
        </div>
      ))}
    </Stack>
  );
}

/** A node row skeleton with the geometry of the loaded row (no layout shift on arrival). */
function RowSkeleton() {
  return (
    <Row gap={5} align="center" style={{ width: '100%' }}>
      <Skeleton circle w={28} />
      <Stack gap={3} style={{ flex: 1 }}>
        <Skeleton w="54%" h={13} />
        <Skeleton w="32%" h={10} />
      </Stack>
      <Skeleton w={52} h={20} radius={999} />
    </Row>
  );
}

/** Gallery section: Skeleton, EmptyState, ErrorState and QueryBoundary. */
export function StatesSection() {
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    window.setTimeout(() => setRetrying(false), 1400);
  };

  return (
    <GallerySection
      id="states"
      title="Loading, empty and error"
      lead="Never a spinner, never a blank. Loading shows the shape of what is coming so nothing jumps when it lands; empty says what happened and what to do next; errors say the same and offer a retry only where retrying can help."
    >
      <SpecGrid min={380}>
        <Specimen
          title="Skeleton."
          caption="Shimmering blocks with the geometry of the content. The sweep is one transform animation and stops under reduced motion."
          layout="stack"
          surface="raised"
        >
          <RowSkeleton />
          <RowSkeleton />
          <SkeletonText lines={3} />
          <Row gap={4}>
            <Skeleton w={96} h={26} radius={999} />
            <Skeleton w={72} h={26} radius={999} />
            <Skeleton w={120} h={26} radius={999} />
          </Row>
        </Specimen>
        <Specimen
          title="EmptyState."
          caption="One icon, one sentence, one action. The lattice appears only on full-pane states, never behind dense data."
          surface="raised"
        >
          <EmptyState
            pattern
            icon={SearchX}
            title="No nodes match these filters"
            action={<Button size="sm">Clear filters</Button>}
          >
            Try a wider tier or remove the country filter.
          </EmptyState>
        </Specimen>
        <Specimen title="EmptyState, compact." caption="Inside a table or a card." surface="raised">
          <Card padding="none" tone="flat" style={{ width: '100%' }}>
            <EmptyState compact icon={Server} title="No apps on this node">
              It is not running any deployments yet.
            </EmptyState>
          </Card>
        </Specimen>
        <Specimen
          title="ErrorState."
          caption="Copy and tone come from the error: unreachable upstream is a warning, a bad request is an error. Retry only appears when it can help."
          layout="stack"
        >
          <ErrorState
            error={new ApiError('upstream', 'upstream failed', 502, '/api/v1/nodes')}
            onRetry={retry}
            retrying={retrying}
          />
          <ErrorState
            error={new ApiError('not_found', 'no such node', 404, '/api/v1/nodes/x')}
            onRetry={retry}
          />
        </Specimen>
        <Specimen
          title="ErrorState, offline and server error."
          caption="Both are retryable, so each gets its button."
          layout="stack"
        >
          <ErrorState
            error={new ApiError('network', 'Failed to fetch', 0, '/api/v1/nodes')}
            onRetry={retry}
            compact
          />
          <ErrorState error={new ApiError('http', 'boom', 500, '/api/v1/blocks')} onRetry={retry} compact />
        </Specimen>
        <Specimen
          title="QueryBoundary."
          caption="One wrapper for every query: loading, error with retry, empty, data, and a failed refresh that keeps the last data on screen and says how old it is."
          layout="stack"
          span={2}
        >
          <div className="kg-qb-grid">
            <Card padding="md">
              <Stack gap={4}>
                <b className="kg-qb-title">Loading</b>
                <QueryBoundary query={pending} skeleton={<RowSkeleton />}>
                  {(items) => <NodeList items={items} />}
                </QueryBoundary>
              </Stack>
            </Card>
            <Card padding="md">
              <Stack gap={4}>
                <b className="kg-qb-title">Failed</b>
                <QueryBoundary query={failed} compact>
                  {(items) => <NodeList items={items} />}
                </QueryBoundary>
              </Stack>
            </Card>
            <Card padding="md">
              <Stack gap={4}>
                <b className="kg-qb-title">Empty</b>
                <QueryBoundary
                  query={empty}
                  isEmpty={(items) => items.length === 0}
                  empty={
                    <EmptyState compact icon={Server} title="No nodes in the queue">
                      The next block will refill it.
                    </EmptyState>
                  }
                >
                  {(items) => <NodeList items={items} />}
                </QueryBoundary>
              </Stack>
            </Card>
            <Card padding="md">
              <Stack gap={4}>
                <b className="kg-qb-title">Stale after a failed refresh</b>
                <QueryBoundary query={stale}>{(items) => <NodeList items={items} />}</QueryBoundary>
              </Stack>
            </Card>
          </div>
        </Specimen>
      </SpecGrid>
    </GallerySection>
  );
}
