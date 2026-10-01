import { describe, expect, it } from 'vitest';
import { NodeState } from '../types';
import { NodeStore } from './store';

describe('selection serial', () => {
  it('counts selections as they start, so the lock ring can restart with each', () => {
    const s = new NodeStore(64);
    const a = s.add({ id: 1, lat: 10, lon: 20, tier: 1, status: 1, flags: 0, loc: 1 }, -1e9);
    const b = s.add({ id: 2, lat: 11, lon: 21, tier: 2, status: 1, flags: 0, loc: 2 }, -1e9);
    expect(s.selectionSerial).toBe(0);
    s.setState(a, NodeState.Selected, true);
    expect(s.selectionSerial).toBe(1);
    // Already selected: not a new selection.
    s.setState(a, NodeState.Selected, true);
    expect(s.selectionSerial).toBe(1);
    // Ending a selection, or any other state bit, does not count.
    s.setState(a, NodeState.Selected, false);
    s.setState(b, NodeState.Hovered, true);
    expect(s.selectionSerial).toBe(1);
    s.setState(b, NodeState.Selected, true);
    expect(s.selectionSerial).toBe(2);
    // Selecting the same node again starts its lock-on again.
    s.setState(a, NodeState.Selected, true);
    expect(s.selectionSerial).toBe(3);
  });
});
