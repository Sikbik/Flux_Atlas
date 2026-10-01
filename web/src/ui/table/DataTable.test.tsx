// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, type Mounted, mount, press } from '../internal/testing';
import { DataTable } from './DataTable';
import type { DataTableColumn } from './types';
import { useFreshKeys } from './useFreshKeys';

interface R {
  id: number;
  name: string;
  rank: number | null;
}

const mk = (n: number): R[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `node-${i + 1}`, rank: i + 1 }));

const columns: DataTableColumn<R>[] = [
  { id: 'name', header: 'Node', sortable: true, mono: true },
  { id: 'rank', header: 'Rank', sortable: true, numeric: true },
];

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const q = <T extends Element>(root: ParentNode, sel: string) => root.querySelector<T>(sel);
const qa = (root: ParentNode, sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
const names = (root: ParentNode) => qa(root, '.ui-table__row [data-col="name"]').map((c) => c.textContent);

describe('DataTable structure', () => {
  it('renders a labelled grid with header and rows, and Unknown for missing values', () => {
    const rows: R[] = [
      { id: 1, name: 'a', rank: 1234 },
      { id: 2, name: 'b', rank: null },
    ];
    mounted = mount(<DataTable aria-label="Nodes" rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const grid = q<HTMLElement>(mounted.container, '[role="grid"]')!;
    expect(grid.getAttribute('aria-label')).toBe('Nodes');
    expect(grid.getAttribute('aria-rowcount')).toBe('3');
    expect(grid.getAttribute('aria-colcount')).toBe('2');
    expect(grid.tabIndex).toBe(0);
    expect(qa(grid, '[role="columnheader"]')).toHaveLength(2);
    expect(qa(grid, '.ui-table__row')).toHaveLength(2);
    const cells = qa(grid, '.ui-table__row [data-col="rank"]');
    expect(cells[0]!.textContent).toBe('1,234');
    expect(cells[1]!.textContent).toBe('Unknown');
    expect(q(cells[1]!, '.ui-unknown')).not.toBeNull();
    expect(qa(grid, '.ui-table__row')[0]!.getAttribute('aria-rowindex')).toBe('2');
  });

  it('shows skeleton rows while loading and an empty state when there is nothing', () => {
    mounted = mount(
      <DataTable
        aria-label="Nodes"
        rows={[]}
        columns={columns}
        rowKey={(r) => r.id}
        loading
        skeletonRows={5}
      />,
    );
    expect(qa(mounted.container, '.ui-table__skeleton .ui-table__row')).toHaveLength(5);
    expect(q(mounted.container, '[role="grid"]')!.getAttribute('aria-busy')).toBe('true');
    mounted.rerender(<DataTable aria-label="Nodes" rows={[]} columns={columns} rowKey={(r) => r.id} />);
    expect(q(mounted.container, '.ui-state')).not.toBeNull();
    mounted.rerender(
      <DataTable
        aria-label="Nodes"
        rows={[]}
        columns={columns}
        rowKey={(r) => r.id}
        empty={<p>No matches</p>}
      />,
    );
    expect(mounted.container.textContent).toContain('No matches');
  });

  it('keeps rows on screen when loading flips on after data exists', () => {
    mounted = mount(
      <DataTable aria-label="Nodes" rows={mk(3)} columns={columns} rowKey={(r) => r.id} loading />,
    );
    expect(qa(mounted.container, '.ui-table__row')).toHaveLength(3);
    expect(q(mounted.container, '.ui-table__skeleton')).toBeNull();
  });
});

describe('DataTable sorting', () => {
  it('cycles a numeric column descending, ascending, then unsorted', () => {
    mounted = mount(<DataTable aria-label="Nodes" rows={mk(4)} columns={columns} rowKey={(r) => r.id} />);
    const c = mounted.container;
    const rankBtn = qa(c, '.ui-table__sort')[1]!;
    const rankHead = qa(c, '[role="columnheader"]')[1]!;
    expect(rankHead.getAttribute('aria-sort')).toBe('none');
    click(rankBtn);
    expect(names(c)).toEqual(['node-4', 'node-3', 'node-2', 'node-1']);
    expect(rankHead.getAttribute('aria-sort')).toBe('descending');
    click(rankBtn);
    expect(names(c)).toEqual(['node-1', 'node-2', 'node-3', 'node-4']);
    expect(rankHead.getAttribute('aria-sort')).toBe('ascending');
    click(rankBtn);
    expect(rankHead.getAttribute('aria-sort')).toBe('none');
  });

  it('sorts Unknown values last in both directions', () => {
    const rows: R[] = [
      { id: 1, name: 'a', rank: null },
      { id: 2, name: 'b', rank: 5 },
      { id: 3, name: 'c', rank: 9 },
    ];
    mounted = mount(<DataTable aria-label="Nodes" rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const btn = qa(mounted.container, '.ui-table__sort')[1]!;
    click(btn); // desc
    expect(names(mounted.container)).toEqual(['c', 'b', 'a']);
    click(btn); // asc
    expect(names(mounted.container)).toEqual(['b', 'c', 'a']);
  });

  it('is controllable and reports every change', () => {
    const onSortChange = vi.fn();
    mounted = mount(
      <DataTable
        aria-label="Nodes"
        rows={mk(3)}
        columns={columns}
        rowKey={(r) => r.id}
        sort={{ id: 'name', dir: 'desc' }}
        onSortChange={onSortChange}
      />,
    );
    expect(names(mounted.container)).toEqual(['node-3', 'node-2', 'node-1']);
    click(qa(mounted.container, '.ui-table__sort')[1]!);
    expect(onSortChange).toHaveBeenCalledWith({ id: 'rank', dir: 'desc' });
    // Controlled: the rows did not move until the parent says so.
    expect(names(mounted.container)).toEqual(['node-3', 'node-2', 'node-1']);
  });
});

describe('DataTable interaction', () => {
  it('reports row clicks, but not clicks on controls inside a row', () => {
    const onRowClick = vi.fn();
    const inner = vi.fn();
    const cols: DataTableColumn<R>[] = [
      {
        id: 'name',
        header: 'Node',
        cell: (r) => (
          <button type="button" onClick={inner}>
            {r.name}
          </button>
        ),
      },
      { id: 'rank', header: 'Rank' },
    ];
    mounted = mount(
      <DataTable
        aria-label="Nodes"
        rows={mk(2)}
        columns={cols}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    click(q(mounted.container, '.ui-table__row button')!);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(onRowClick).not.toHaveBeenCalled();
    click(qa(mounted.container, '.ui-table__row [data-col="rank"]')[1]!);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0]![0]).toMatchObject({ id: 2 });
  });

  it('does not throw without a router when rowLink is set', () => {
    const onRowClick = vi.fn();
    mounted = mount(
      <DataTable
        aria-label="Nodes"
        rows={mk(2)}
        columns={columns}
        rowKey={(r) => r.id}
        rowLink={(r) => ({ kind: 'node', value: `10.0.0.${r.id}:16127` })}
        onRowClick={onRowClick}
      />,
    );
    const row = q<HTMLElement>(mounted.container, '.ui-table__row')!;
    expect(row.hasAttribute('data-link')).toBe(true);
    expect(() => click(row)).not.toThrow();
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('is one tab stop with a roving active row driven by the keyboard', () => {
    const onRowClick = vi.fn();
    mounted = mount(
      <DataTable
        aria-label="Nodes"
        rows={mk(30)}
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    const grid = q<HTMLElement>(mounted.container, '[role="grid"]')!;
    expect(grid.hasAttribute('aria-activedescendant')).toBe(false);
    act(() => grid.focus());
    const first = qa(grid, '.ui-table__row')[0]!;
    expect(grid.getAttribute('aria-activedescendant')).toBe(first.id);
    press(grid, 'ArrowDown');
    press(grid, 'ArrowDown');
    const rows = qa(grid, '.ui-table__row');
    expect(grid.getAttribute('aria-activedescendant')).toBe(rows[2]!.id);
    expect(rows[2]!.hasAttribute('data-active')).toBe(true);
    press(grid, 'End');
    expect(grid.getAttribute('aria-activedescendant')).toBe(qa(grid, '.ui-table__row').at(-1)!.id);
    press(grid, 'Home');
    press(grid, 'PageDown');
    expect(
      qa(grid, '.ui-table__row')[
        qa(grid, '.ui-table__row').findIndex((r) => r.hasAttribute('data-active'))
      ]!.getAttribute('aria-rowindex'),
    ).not.toBe('2');
    press(grid, 'Enter');
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('ignores keys that come from controls inside the grid', () => {
    const onRowClick = vi.fn();
    mounted = mount(
      <DataTable
        aria-label="Nodes"
        rows={mk(3)}
        columns={columns}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    const grid = q<HTMLElement>(mounted.container, '[role="grid"]')!;
    act(() => grid.focus());
    press(qa(grid, '.ui-table__sort')[0]!, 'Enter');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('marks the selected row', () => {
    mounted = mount(
      <DataTable aria-label="Nodes" rows={mk(3)} columns={columns} rowKey={(r) => r.id} selectedKey={2} />,
    );
    const rows = qa(mounted.container, '.ui-table__row');
    expect(rows.map((r) => r.hasAttribute('data-selected'))).toEqual([false, true, false]);
    expect(rows[1]!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('DataTable windowing and memoisation', () => {
  it('renders only the visible rows above 200 and keeps the full row count in aria', () => {
    mounted = mount(<DataTable aria-label="Nodes" rows={mk(1000)} columns={columns} rowKey={(r) => r.id} />);
    const grid = q<HTMLElement>(mounted.container, '[role="grid"]')!;
    const n = qa(grid, '.ui-table__row').length;
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(60);
    expect(grid.getAttribute('aria-rowcount')).toBe('1001');
    expect(q<HTMLElement>(grid, '.ui-table__body')!.style.height).toBe('34000px');
  });

  it('renders everything at or below the threshold and when virtualisation is off', () => {
    mounted = mount(<DataTable aria-label="Nodes" rows={mk(150)} columns={columns} rowKey={(r) => r.id} />);
    expect(qa(mounted.container, '.ui-table__row')).toHaveLength(150);
    mounted.rerender(
      <DataTable
        aria-label="Nodes"
        rows={mk(300)}
        columns={columns}
        rowKey={(r) => r.id}
        virtualize={false}
      />,
    );
    expect(qa(mounted.container, '.ui-table__row')).toHaveLength(300);
  });

  it('re-renders only the row whose object changed', () => {
    const calls = new Map<number, number>();
    const cols: DataTableColumn<R>[] = [
      {
        id: 'name',
        header: 'Node',
        cell: (r) => {
          calls.set(r.id, (calls.get(r.id) ?? 0) + 1);
          return r.name;
        },
      },
    ];
    const rows = mk(20);
    const key = (r: R) => r.id;
    mounted = mount(<DataTable aria-label="Nodes" rows={rows} columns={cols} rowKey={key} />);
    expect([...calls.values()].every((v) => v === 1)).toBe(true);
    const next = rows.slice();
    next[7] = { ...next[7]!, name: 'changed' };
    calls.clear();
    mounted.rerender(<DataTable aria-label="Nodes" rows={next} columns={cols} rowKey={key} />);
    expect([...calls.entries()]).toEqual([[8, 1]]);
    expect(names(mounted.container)[7]).toBe('changed');
  });

  it('does not remount existing rows when a row is inserted at the top', () => {
    const rows = mk(5);
    mounted = mount(<DataTable aria-label="Nodes" rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const before = qa(mounted.container, '.ui-table__row');
    const added: R = { id: 99, name: 'new', rank: 99 };
    mounted.rerender(
      <DataTable aria-label="Nodes" rows={[added, ...rows]} columns={columns} rowKey={(r) => r.id} />,
    );
    const after = qa(mounted.container, '.ui-table__row');
    expect(after).toHaveLength(6);
    for (const el of before) expect(after.includes(el)).toBe(true);
  });

  it('flags highlighted rows', () => {
    mounted = mount(
      <DataTable
        aria-label="Nodes"
        rows={mk(3)}
        columns={columns}
        rowKey={(r) => r.id}
        highlightKeys={new Set([3])}
      />,
    );
    expect(qa(mounted.container, '.ui-table__row').map((r) => r.hasAttribute('data-fresh'))).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe('useFreshKeys', () => {
  function Probe({ rows, onFresh }: { rows: R[]; onFresh: (s: ReadonlySet<string | number>) => void }) {
    onFresh(useFreshKeys(rows, (r) => r.id, 1000));
    return null;
  }

  it('highlights arrivals for the ttl and never the first render', () => {
    vi.useFakeTimers();
    try {
      let fresh: ReadonlySet<string | number> = new Set();
      const rows = mk(3);
      const m = mount(<Probe rows={rows} onFresh={(s) => (fresh = s)} />);
      expect(fresh.size).toBe(0);
      m.rerender(<Probe rows={[{ id: 50, name: 'x', rank: 1 }, ...rows]} onFresh={(s) => (fresh = s)} />);
      expect([...fresh]).toEqual([50]);
      act(() => {
        vi.advanceTimersByTime(1100);
      });
      expect(fresh.size).toBe(0);
      m.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
