import { beforeEach, describe, expect, it } from 'vitest';
import { toast, useToasts } from './toasts';

describe('the toast store', () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
  });

  it('lives five seconds, seven for an achievement, and keeps an explicit lifetime', () => {
    toast({ kind: 'info', title: 'a' });
    toast({ kind: 'achievement', title: 'b' });
    toast({ kind: 'error', title: 'c', ttlMs: 0 });
    toast({ kind: 'info', title: 'd', ttlMs: 9000 });
    expect(useToasts.getState().toasts.map((t) => t.ttlMs)).toEqual([5000, 7000, 0, 9000]);
  });

  it('refreshes a toast with the same key instead of stacking another', () => {
    const a = toast({ kind: 'watch', key: 'pay:1', title: 'Payment received, +9.00 FLUX' });
    toast({ kind: 'info', title: 'other' });
    const b = toast({ kind: 'watch', key: 'pay:1', title: 'Payment received, +3.50 FLUX' });
    const list = useToasts.getState().toasts;
    expect(b).toBe(a);
    expect(list).toHaveLength(2);
    expect(list[0]?.title).toBe('Payment received, +3.50 FLUX');
    expect(list[0]?.id).toBe(a);
  });

  it('keeps at most five and drops the oldest', () => {
    for (let i = 0; i < 7; i++) toast({ kind: 'info', title: String(i) });
    expect(useToasts.getState().toasts.map((t) => t.title)).toEqual(['2', '3', '4', '5', '6']);
  });

  it('dismisses by id', () => {
    const a = toast({ kind: 'info', title: 'a' });
    toast({ kind: 'info', title: 'b' });
    useToasts.getState().dismiss(a);
    expect(useToasts.getState().toasts.map((t) => t.title)).toEqual(['b']);
  });
});
