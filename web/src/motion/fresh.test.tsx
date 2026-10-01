// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '../ui/internal/testing';
import { arrivals, FRESH_MS, useFresh } from './fresh';

describe('arrivals', () => {
  it('finds the keys that appeared', () => {
    expect(arrivals(new Set(['a', 'b']), ['c', 'a', 'b'])).toEqual(['c']);
    expect(arrivals(new Set(['a', 'b']), ['d', 'c', 'a', 'b'])).toEqual(['d', 'c']);
  });

  it('is nothing on the first fill', () => {
    expect(arrivals(null, ['a', 'b'])).toEqual([]);
    expect(arrivals(new Set(), ['a', 'b'])).toEqual([]);
  });

  it('is nothing when the set is unchanged or only lost keys', () => {
    expect(arrivals(new Set(['a']), ['a'])).toEqual([]);
    expect(arrivals(new Set(['a', 'b']), ['a'])).toEqual([]);
  });

  it('treats more than `max` at once as a refill, not an arrival', () => {
    expect(arrivals(new Set(['x']), ['a', 'b', 'c', 'x'], 2)).toEqual([]);
    expect(arrivals(new Set(['x']), ['a', 'b', 'x'], 2)).toEqual(['a', 'b']);
    // no limit by default: a burst of rows is all fresh
    expect(arrivals(new Set(['x']), ['a', 'b', 'c', 'x'])).toEqual(['a', 'b', 'c']);
  });
});

/** A list that renders the way the contract says: `data-fresh` from `useFresh`, nothing else. */
function List(props: { keys: readonly string[]; ms?: number; max?: number; scope?: string }) {
  const fresh = useFresh(props.keys, { ms: props.ms, max: props.max, scope: props.scope });
  return (
    <ul>
      {props.keys.map((k) => (
        <li key={k} data-k={k} data-fresh={fresh.has(k) || undefined} />
      ))}
    </ul>
  );
}

const freshKeys = (root: ParentNode): string[] =>
  [...root.querySelectorAll('[data-fresh]')].map((n) => n.getAttribute('data-k') ?? '');

describe('useFresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks nothing on the first fill, whatever it holds', () => {
    const m = mount(<List keys={['a', 'b', 'c']} />);
    expect(freshKeys(m.container)).toEqual([]);
    m.unmount();
  });

  it('marks an arrival, and the element takes the attribute after it exists', () => {
    const m = mount(<List keys={['a', 'b']} />);
    // What the engine sees: an attribute that APPEARS on an element that is already in the document.
    const seen: { key: string | null; old: string | null }[] = [];
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        if (r.attributeName === 'data-fresh') {
          seen.push({ key: (r.target as Element).getAttribute('data-k'), old: r.oldValue });
        }
      }
    });
    watch.observe(m.container, { subtree: true, attributes: true, attributeOldValue: true });
    m.rerender(<List keys={['c', 'a', 'b']} />);
    expect(freshKeys(m.container)).toEqual(['c']);
    for (const r of watch.takeRecords()) {
      if (r.attributeName === 'data-fresh') {
        seen.push({ key: (r.target as Element).getAttribute('data-k'), old: r.oldValue });
      }
    }
    watch.disconnect();
    expect(seen).toEqual([{ key: 'c', old: null }]);
    m.unmount();
  });

  it('lets go after `ms`, and defaults to the wash length', () => {
    expect(FRESH_MS).toBe(1800);
    const m = mount(<List keys={['a']} ms={500} />);
    m.rerender(<List keys={['b', 'a']} ms={500} />);
    expect(freshKeys(m.container)).toEqual(['b']);
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(freshKeys(m.container)).toEqual(['b']);
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(freshKeys(m.container)).toEqual([]);
    m.unmount();
  });

  it('keeps an arrival fresh through unrelated re-renders', () => {
    const m = mount(<List keys={['a']} ms={800} />);
    m.rerender(<List keys={['b', 'a']} ms={800} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    m.rerender(<List keys={['b', 'a']} ms={800} />);
    expect(freshKeys(m.container)).toEqual(['b']);
    m.unmount();
  });

  it('treats more than `max` at once, and a change of scope, as a refill', () => {
    const m = mount(<List keys={['a']} max={2} scope="all" />);
    m.rerender(<List keys={['x', 'y', 'z', 'a']} max={2} scope="all" />);
    expect(freshKeys(m.container)).toEqual([]);
    m.rerender(<List keys={['w', 'x', 'y', 'z', 'a']} max={2} scope="all" />);
    expect(freshKeys(m.container)).toEqual(['w']);
    m.rerender(<List keys={['q', 'w', 'x', 'y', 'z', 'a']} max={2} scope="mine" />);
    expect(freshKeys(m.container)).toEqual(['w']);
    m.unmount();
  });

  it('leaves no timer behind when it unmounts', () => {
    const m = mount(<List keys={['a']} />);
    m.rerender(<List keys={['b', 'a']} />);
    expect(vi.getTimerCount()).toBe(1);
    m.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
