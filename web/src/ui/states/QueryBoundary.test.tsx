// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/http';
import { click, mount } from '../internal/testing';
import { QueryBoundary, type QueryLike } from './QueryBoundary';

function query(over: Partial<QueryLike<string[]>>): QueryLike<string[]> {
  return {
    data: undefined,
    isPending: true,
    isError: false,
    error: null,
    refetch: () => undefined,
    isFetching: false,
    ...over,
  };
}

const list = (items: string[]) => (
  <ul>
    {items.map((i) => (
      <li key={i}>{i}</li>
    ))}
  </ul>
);

describe('QueryBoundary', () => {
  it('shows a busy skeleton region with a spoken "Loading" while the first load runs', () => {
    const m = mount(<QueryBoundary query={query({})}>{list}</QueryBoundary>);
    const region = m.container.querySelector('[role="status"]');
    expect(region?.getAttribute('aria-busy')).toBe('true');
    expect(region?.textContent).toContain('Loading');
    expect(m.container.querySelector('li')).toBeNull();
    m.unmount();
  });

  it('uses the geometry-matching skeleton the caller passes', () => {
    const m = mount(
      <QueryBoundary query={query({})} skeleton={<div data-testid="skel">rows</div>}>
        {list}
      </QueryBoundary>,
    );
    expect(m.container.querySelector('[data-testid="skel"]')).not.toBeNull();
    m.unmount();
  });

  it('renders an alert with a Retry that refetches when the first load fails', () => {
    const refetch = vi.fn();
    const m = mount(
      <QueryBoundary
        query={query({
          isPending: false,
          isError: true,
          error: new ApiError('upstream', 'behind', 502, '/api/v1/nodes'),
          refetch,
        })}
      >
        {list}
      </QueryBoundary>,
    );
    expect(m.container.querySelector('[role="alert"]')).not.toBeNull();
    const retry = Array.from(m.container.querySelectorAll('button')).find((b) => b.textContent === 'Retry');
    expect(retry).toBeDefined();
    if (retry) click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  it('hides Retry for an error that retrying cannot fix', () => {
    const m = mount(
      <QueryBoundary
        query={query({
          isPending: false,
          isError: true,
          error: new ApiError('not_found', 'none', 404, '/api/v1/nodes/x'),
        })}
      >
        {list}
      </QueryBoundary>,
    );
    expect(m.container.querySelector('button')).toBeNull();
    m.unmount();
  });

  it('renders the children with the data once it is there', () => {
    const m = mount(
      <QueryBoundary query={query({ data: ['a', 'b'], isPending: false })}>{list}</QueryBoundary>,
    );
    expect(Array.from(m.container.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['a', 'b']);
    expect(m.container.querySelector('[aria-busy]')).toBeNull();
    m.unmount();
  });

  it('shows the empty state instead of the children when the data is empty', () => {
    const m = mount(
      <QueryBoundary
        query={query({ data: [], isPending: false })}
        isEmpty={(d) => d.length === 0}
        empty={<p data-testid="empty">No nodes</p>}
      >
        {list}
      </QueryBoundary>,
    );
    expect(m.container.querySelector('[data-testid="empty"]')).not.toBeNull();
    expect(m.container.querySelector('ul')).toBeNull();
    m.unmount();
  });

  it('keeps stale data on screen after a failed refresh and says so', () => {
    const m = mount(
      <QueryBoundary
        query={query({
          data: ['kept'],
          isPending: false,
          isError: true,
          error: new ApiError('network', 'offline', 0, '/api/v1/nodes'),
          dataUpdatedAt: Date.now() - 5 * 60_000,
        })}
      >
        {list}
      </QueryBoundary>,
    );
    expect(m.container.querySelector('li')?.textContent).toBe('kept');
    expect(m.container.textContent).toContain('Could not refresh');
    expect(m.container.querySelector('time')).not.toBeNull();
    m.unmount();
  });
});
