import { describe, expect, it } from 'vitest';
import type { WindowRef } from '../../shell/wm/types';
import { alongsideExtras, keepTerminalExtras, pathFromTarget, resolveNavigation } from './navigation';

const win = (type: WindowRef['type'], key: string | null = null): WindowRef => ({ type, key });

describe('pathFromTarget', () => {
  it('fills and encodes route params', () => {
    expect(pathFromTarget({ to: '/node/$key', params: { key: '65.109.26.93:16147' } })).toBe(
      '/node/65.109.26.93%3A16147',
    );
    expect(pathFromTarget({ to: '/queue' })).toBe('/queue');
    expect(pathFromTarget({ to: '/app/$name/history/$n', params: { name: 'a b', n: '3' } })).toBe(
      '/app/a%20b/history/3',
    );
  });
});

describe('alongsideExtras', () => {
  it('demotes the current window into the extras, newest last', () => {
    expect(alongsideExtras(win('node', 'a'), [], win('queue'))).toEqual([win('node', 'a')]);
    expect(alongsideExtras(win('node', 'a'), [win('queue')], win('app', 'x'))).toEqual([
      win('queue'),
      win('node', 'a'),
    ]);
  });

  it('keeps at most two and drops the destination type', () => {
    const got = alongsideExtras(win('node', 'a'), [win('queue'), win('about')], win('app', 'x'));
    expect(got).toEqual([win('about'), win('node', 'a')]);
    expect(alongsideExtras(win('node', 'a'), [win('queue')], win('queue'))).toEqual([win('node', 'a')]);
  });

  it('has nothing to demote from the bare globe', () => {
    expect(alongsideExtras(null, [], win('node', 'a'))).toEqual([]);
  });
});

describe('keepTerminalExtras', () => {
  it('keeps the terminal when it was the primary window', () => {
    expect(keepTerminalExtras(win('terminal'), [], win('node', 'a'))).toEqual([win('terminal')]);
  });

  it('keeps an extra terminal and drops the destination type', () => {
    expect(keepTerminalExtras(win('node', 'a'), [win('terminal')], win('app', 'x'))).toEqual([
      win('terminal'),
    ]);
    expect(keepTerminalExtras(win('node', 'a'), [win('terminal'), win('queue')], win('queue'))).toEqual([
      win('terminal'),
    ]);
  });

  it('does nothing without a terminal', () => {
    expect(keepTerminalExtras(win('node', 'a'), [win('queue')], win('app', 'x'))).toEqual([win('queue')]);
  });
});

describe('resolveNavigation', () => {
  const loc = { pathname: '/node/1.2.3.4%3A16127', search: { tier: 'stratus', q: '', sel: 'x', w: 'queue' } };

  it('inherits filters and windows but drops the palette text and the selection', () => {
    const r = resolveNavigation(loc, { to: '/app/$name', params: { name: 'Foo' } }, 'open');
    expect(r.to).toBe('/app/$name');
    expect(r.params).toEqual({ name: 'Foo' });
    expect(r.search).toEqual({ tier: 'stratus', w: 'queue' });
  });

  it('opens alongside by demoting the current window', () => {
    const r = resolveNavigation(loc, { to: '/app/$name', params: { name: 'Foo' } }, 'alongside');
    expect(r.search.w).toBe('queue,node:1.2.3.4%3A16127');
  });

  it('stays on the route for search-only targets and clears keys', () => {
    const r = resolveNavigation(loc, { to: '/', stay: true, search: { cc: 'FI' }, clear: ['tier'] }, 'open');
    expect(r.to).toBe('.');
    expect(r.search).toEqual({ cc: 'FI', w: 'queue' });
  });

  it('keeps the terminal open while a command moves the primary window', () => {
    const r = resolveNavigation(
      { pathname: '/terminal', search: {} },
      { to: '/node/$key', params: { key: '1.2.3.4:16127' } },
      'keepTerminal',
    );
    expect(r.search.w).toBe('terminal');
  });
});
