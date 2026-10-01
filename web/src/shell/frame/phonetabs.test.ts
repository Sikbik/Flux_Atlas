import { describe, expect, it } from 'vitest';
import { activeTab, PHONE_TABS, paletteView, type TabState } from './phonetabs';

const base: TabState = { palette: 'closed', liveOpen: false, sheet: null, results: false };

describe('paletteView', () => {
  it('is closed without q, open with q (even empty), and apps on the apps prefix', () => {
    expect(paletteView('')).toBe('closed');
    expect(paletteView('?w=queue')).toBe('closed');
    expect(paletteView('?q=')).toBe('open');
    expect(paletteView('?boot=off&q=hetzner')).toBe('open');
    expect(paletteView('?q=app%20')).toBe('apps');
    expect(paletteView('?q=apps%20flux')).toBe('apps');
    expect(paletteView('?q=App%20Fluxnode')).toBe('apps');
  });

  it('needs the prefix word and a space: the first letters of a word are not a scope yet', () => {
    expect(paletteView('?q=app')).toBe('open');
    expect(paletteView('?q=application')).toBe('open');
    expect(paletteView('?q=operator%20')).toBe('open');
  });
});

describe('the phone tabs', () => {
  it('are the five of the design, in order', () => {
    expect(PHONE_TABS.map((t) => t.id)).toEqual(['globe', 'live', 'search', 'apps', 'you']);
  });

  it('light Globe on the bare globe and Live while its sheet is open', () => {
    expect(activeTab(base)).toBe('globe');
    expect(activeTab({ ...base, liveOpen: true })).toBe('live');
  });

  it('light the tab a sheet belongs to, and Globe for everything about the chain and the map', () => {
    const at = (sheet: TabState['sheet']) => activeTab({ ...base, sheet });
    expect(at('app')).toBe('apps');
    expect(at('operator')).toBe('you');
    expect(at('settings')).toBe('you');
    for (const t of ['node', 'host', 'block', 'tx', 'address', 'queue', 'analytics', 'about'] as const)
      expect(at(t)).toBe('globe');
  });

  it('light Search while the palette is open, over anything else', () => {
    expect(activeTab({ ...base, palette: 'open', liveOpen: true, sheet: 'node' })).toBe('search');
  });

  it('keep Apps lit while the palette is open on the apps prefix', () => {
    expect(activeTab({ ...base, palette: 'apps' })).toBe('apps');
    expect(activeTab({ ...base, palette: 'apps', sheet: 'settings' })).toBe('apps');
  });

  it('a window wins over a Live sheet that has not closed yet', () => {
    expect(activeTab({ ...base, liveOpen: true, sheet: 'node' })).toBe('globe');
  });

  it('light Search on the results page, below a sheet and the Live sheet', () => {
    expect(activeTab({ ...base, results: true })).toBe('search');
    expect(activeTab({ ...base, results: true, liveOpen: true })).toBe('live');
    expect(activeTab({ ...base, results: true, sheet: 'app' })).toBe('apps');
  });
});
