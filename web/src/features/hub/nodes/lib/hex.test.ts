import { describe, expect, it } from 'vitest';
import { cellOwners, hexGrid } from './hex';

describe('hexGrid', () => {
  const g = hexGrid(10, 10, 11);

  it('makes a cell for every place, in reading order', () => {
    expect(g.cells).toHaveLength(100);
    expect(g.cells.map((c) => c.index)).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it('shifts every other row half a cell so the hexagons interlock', () => {
    const w = Math.sqrt(3) * 11;
    expect(g.cells[10]!.cx - g.cells[0]!.cx).toBeCloseTo(w / 2);
    expect(g.cells[20]!.cx).toBeCloseTo(g.cells[0]!.cx);
  });

  it('packs the rows at one and a half corner-lengths', () => {
    expect(g.cells[10]!.cy - g.cells[0]!.cy).toBeCloseTo(1.5 * 11);
  });

  it('keeps every corner inside its own box', () => {
    for (const c of g.cells) {
      for (const p of c.points.split(' ')) {
        const [x, y] = p.split(',').map(Number) as [number, number];
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(g.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(g.height);
      }
    }
  });

  it('draws six corners per cell', () => {
    expect(g.cells[0]!.points.split(' ')).toHaveLength(6);
  });

  it('has the size of the whole grid', () => {
    expect(g.width).toBeCloseTo(10.5 * Math.sqrt(3) * 11);
    expect(g.height).toBeCloseTo(9 * 1.5 * 11 + 22);
  });
});

describe('cellOwners', () => {
  it('lays the slices out one after another', () => {
    expect(
      cellOwners([
        { id: 'a', cells: 2 },
        { id: 'b', cells: 1 },
        { id: 'c', cells: 0 },
      ]),
    ).toEqual(['a', 'a', 'b']);
  });
});
