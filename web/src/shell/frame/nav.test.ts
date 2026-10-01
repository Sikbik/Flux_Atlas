import { describe, expect, it } from 'vitest';
import type { WindowRef } from '../wm/types';
import { carriesOver, extrasAfterOpen } from './nav';

const node: WindowRef = { type: 'node', key: '1.2.3.4:16127' };
const app: WindowRef = { type: 'app', key: 'Fluxtracker' };
const queue: WindowRef = { type: 'queue', key: null };
const analytics: WindowRef = { type: 'analytics', key: 'overview' };
const block: WindowRef = { type: 'block', key: '100' };

describe('carriesOver', () => {
  it('keeps a floating primary window when another opens', () => {
    expect(carriesOver(queue, node)).toBe(true);
    expect(carriesOver(analytics, node)).toBe(true);
  });

  it('swaps in place inside the one docked inspector slot', () => {
    expect(carriesOver(node, app)).toBe(false);
    expect(carriesOver(app, node)).toBe(false);
  });

  it('keeps a docked window next to a floating one', () => {
    expect(carriesOver(node, queue)).toBe(true);
  });

  it('never carries over the same type, or nothing', () => {
    expect(carriesOver(node, { type: 'node', key: '9' })).toBe(false);
    expect(carriesOver(null, node)).toBe(false);
  });

  it('does not carry over strip or layer types, which are not framed', () => {
    expect(carriesOver({ type: 'time', key: null }, node)).toBe(false);
    expect(carriesOver({ type: 'weather', key: null }, node)).toBe(false);
  });
});

describe('extrasAfterOpen', () => {
  it('adds the old primary to the extras, newest last', () => {
    expect(extrasAfterOpen({ primary: queue, extras: [] }, node)).toEqual([queue]);
    expect(extrasAfterOpen({ primary: analytics, extras: [queue] }, node)).toEqual([queue, analytics]);
  });

  it('keeps at most two extras (the oldest drops)', () => {
    const out = extrasAfterOpen({ primary: analytics, extras: [queue, block] }, node);
    expect(out).toEqual([block, analytics]);
  });

  it('removes the opening type from the extras (it becomes the primary) and the old primary rides', () => {
    const out = extrasAfterOpen({ primary: node, extras: [queue] }, queue);
    expect(out).toEqual([node]);
  });

  it('does not duplicate a type that is already in the extras', () => {
    const out = extrasAfterOpen({ primary: queue, extras: [] }, { type: 'queue', key: 'stratus' });
    expect(out).toEqual([]);
  });
});
