import { describe, expect, it } from 'vitest';
import { activeTab, PHONE_TABS } from './phonetabs';

describe('the phone tabs', () => {
  it('are the five of the design, in order', () => {
    expect(PHONE_TABS.map((t) => t.id)).toEqual(['globe', 'live', 'search', 'apps', 'you']);
  });

  it('light Globe on the bare globe and Live while its sheet is open', () => {
    expect(activeTab({ paletteOpen: false, liveOpen: false, sheet: null })).toBe('globe');
    expect(activeTab({ paletteOpen: false, liveOpen: true, sheet: null })).toBe('live');
  });

  it('light the tab a sheet belongs to, and Globe for everything about the chain and the map', () => {
    const at = (sheet: Parameters<typeof activeTab>[0]['sheet']) =>
      activeTab({ paletteOpen: false, liveOpen: false, sheet });
    expect(at('app')).toBe('apps');
    expect(at('operator')).toBe('you');
    expect(at('settings')).toBe('you');
    for (const t of ['node', 'host', 'block', 'tx', 'address', 'queue', 'analytics', 'about'] as const)
      expect(at(t)).toBe('globe');
  });

  it('light Search while the palette is open, over anything else', () => {
    expect(activeTab({ paletteOpen: true, liveOpen: true, sheet: 'node' })).toBe('search');
  });

  it('a window wins over a Live sheet that has not closed yet', () => {
    expect(activeTab({ paletteOpen: false, liveOpen: true, sheet: 'node' })).toBe('globe');
  });
});
