import { describe, expect, it } from 'vitest';
import { ACTIONS, actionById, actionScore } from './actions';

const need = (id: string) => {
  const a = actionById(id);
  if (!a) throw new Error(`no action ${id}`);
  return a;
};

describe('actionScore', () => {
  it('counts a page whose first word is exactly what was typed as a hit on its name', () => {
    const rich = need('view.richlist');
    expect(actionScore(rich, 'rich')).toBe(100);
    expect(actionScore(rich, '  RICH ')).toBe(100);
    expect(actionScore(need('view.operators'), 'top')).toBe(100);
  });

  it('leaves a partial word, or one that is too short, to the ordinary match', () => {
    const rich = need('view.richlist');
    expect(actionScore(rich, 'ric')).toBeLessThan(100);
    expect(actionScore(rich, 'richl')).toBeLessThan(100);
    expect(actionScore(rich, 'ri')).toBeLessThan(100);
  });

  it('keeps an exact title at 100 and a keyword below it', () => {
    const rich = need('view.richlist');
    expect(actionScore(rich, 'rich list')).toBe(100);
    expect(actionScore(rich, 'whales')).toBeGreaterThan(0);
    expect(actionScore(rich, 'whales')).toBeLessThan(100);
  });

  it('does not lift anything that is not a page', () => {
    const ambient = need('ambient.enter');
    expect(ambient.chip).not.toBe('Page');
    expect(actionScore(ambient, 'ambient')).toBeLessThan(100);
  });

  it('finds nothing for words that match nothing', () => {
    for (const a of ACTIONS) expect(actionScore(a, 'zzzqqq')).toBe(0);
  });
});
