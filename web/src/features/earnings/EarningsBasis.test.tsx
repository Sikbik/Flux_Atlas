// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUi } from '../../store/ui';
import { click, flush, mount } from '../../ui/internal/testing';
import { byRole, instantMotion } from '../../ui/popover/testUtils';
import { EarningsBasis } from './EarningsBasis';

let restore: () => void;
beforeEach(() => {
  restore = instantMotion();
  useUi.setState({ includePa: true });
});
afterEach(() => {
  restore();
  useUi.setState({ includePa: true });
});

const pill = (root: HTMLElement) => root.querySelector('button.eb') as HTMLButtonElement;
const dialog = () => byRole('dialog')[0];

describe('EarningsBasis', () => {
  it('says main chain + parallel assets by default, with both swatches lit', () => {
    const m = mount(<EarningsBasis />);
    const b = pill(m.container);
    expect(b.textContent).toBe('Main chain + parallel assets');
    expect(b.dataset.basis).toBe('all');
    expect(b.querySelectorAll('.eb__glyph > i')).toHaveLength(2);
    expect(b.getAttribute('aria-haspopup')).toBe('dialog');
    m.unmount();
  });

  it('says main chain only when the preference is off, and follows it live', () => {
    useUi.setState({ includePa: false });
    const m = mount(<EarningsBasis />);
    expect(pill(m.container).textContent).toBe('Main chain only');
    expect(pill(m.container).dataset.basis).toBe('main');
    flush(() => useUi.getState().setIncludePa(true));
    expect(pill(m.container).textContent).toBe('Main chain + parallel assets');
    m.unmount();
  });

  it('explains the rule and breaks the group down when opened, and its switch sets the preference', () => {
    const m = mount(<EarningsBasis split={{ native: 14.71, pa: 14.71 }} per="a day" realized />);
    click(pill(m.container));
    const d = dialog() as HTMLElement;
    expect(d.getAttribute('aria-label')).toBe('What these earnings count');
    expect(d.textContent).toContain('accrues as much again across 10 parallel-asset chains');
    expect(d.textContent).toContain('claimable through Flux Fusion');
    // Realized figures say the parallel assets were accrued, not received.
    expect(d.textContent).toContain('never arrive on the main chain');
    const rows = Array.from(d.querySelectorAll('.eb-pop__split > div')).map((r) => r.textContent);
    expect(rows[0]).toContain('Main chain');
    expect(rows[0]).toContain('14.71 FLUX a day');
    expect(rows[1]).toContain('Parallel assets');
    expect(rows[2]).toContain('29.42 FLUX a day');

    const sw = d.querySelector('input[role="switch"]') as HTMLInputElement;
    expect(sw.checked).toBe(true);
    click(sw);
    expect(useUi.getState().includePa).toBe(false);
    // Off: the parallel assets are still shown, marked as not counted, and the total drops to the main chain.
    const after = Array.from(d.querySelectorAll('.eb-pop__split > div')).map((r) => r.textContent);
    expect(after[1]).toContain('not counted');
    expect(after[2]).toContain('14.71 FLUX a day');
    expect(pill(m.container).textContent).toBe('Main chain only');
    m.unmount();
  });

  it('marks per-payment amounts as main chain whatever the preference, with no switch', () => {
    for (const on of [true, false]) {
      useUi.setState({ includePa: on });
      const m = mount(<EarningsBasis kind="payments" />);
      const b = pill(m.container);
      expect(b.textContent).toBe('Main chain');
      expect(b.dataset.kind).toBe('payments');
      expect(b.querySelectorAll('.eb__glyph > i')).toHaveLength(1);
      click(b);
      const d = dialog() as HTMLElement;
      expect(d.getAttribute('aria-label')).toBe('About these payment amounts');
      expect(d.textContent).toContain('payment on the Flux main chain');
      expect(d.querySelector('input[role="switch"]')).toBeNull();
      m.unmount();
    }
  });
});
