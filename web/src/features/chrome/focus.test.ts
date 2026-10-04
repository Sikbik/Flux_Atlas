import { describe, expect, it } from 'vitest';
import { focusLabel, globeFocus } from './focus';

describe('globeFocus', () => {
  it('is null for an ordinary globe and for a single selected node', () => {
    expect(globeFocus({})).toBeNull();
    expect(globeFocus({ sel: 'abc:0' })).toBeNull();
    expect(globeFocus({ watched: false })).toBeNull();
  });

  it('counts a fleet from two nodes up', () => {
    expect(globeFocus({ sel: 'a:0,b:1,c:0' })).toEqual({ fleet: 3, watched: false });
    expect(globeFocus({ sel: 'a:0,,b:1' })).toEqual({ fleet: 2, watched: false });
  });

  it('reads the watchlist flag however the URL spells it', () => {
    expect(globeFocus({ watched: true })).toEqual({ fleet: 0, watched: true });
    expect(globeFocus({ watched: 'true' })).toEqual({ fleet: 0, watched: true });
    expect(globeFocus({ watched: '1', sel: 'a:0,b:0' })).toEqual({ fleet: 2, watched: true });
  });
});

describe('focusLabel', () => {
  it('names what is on the globe', () => {
    expect(focusLabel({ fleet: 0, watched: true }, 20)).toBe('Your 20 watched nodes on the globe');
    expect(focusLabel({ fleet: 0, watched: true }, 1)).toBe('Your watched node on the globe');
    expect(focusLabel({ fleet: 0, watched: true }, 0)).toBe('Your watchlist on the globe');
    expect(focusLabel({ fleet: 50, watched: false }, 0)).toBe('A fleet of 50 nodes on the globe');
    expect(focusLabel({ fleet: 12, watched: true }, 3)).toBe(
      'Your 3 watched nodes and a fleet of 12 nodes on the globe',
    );
  });
});
