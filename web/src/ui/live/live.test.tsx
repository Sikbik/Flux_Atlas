// @vitest-environment jsdom
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '../internal/testing';
import { AnimatedNumber } from './AnimatedNumber';
import { FlashOnChange } from './FlashOnChange';
import { Freshness } from './Freshness';
import { LiveDot } from './LiveDot';

const html = document.documentElement;

afterEach(() => {
  delete html.dataset.motion;
});

describe('AnimatedNumber', () => {
  it('gives screen readers the final text once, and draws the digits aria-hidden', () => {
    const m = mount(<AnimatedNumber value={6724} />);
    expect(m.container.querySelector('.ui-sr-only')?.textContent).toBe('6,724');
    expect(m.container.querySelector('.ui-number__live')?.getAttribute('aria-hidden')).toBe('true');
    expect(m.container.querySelector('[aria-live]')).toBeNull();
    m.unmount();
  });

  it('renders Unknown for null and undefined, never a zero', () => {
    const m = mount(<AnimatedNumber value={null} />);
    const root = m.container.firstElementChild as HTMLElement;
    expect(root.textContent).toBe('Unknown');
    expect(root.getAttribute('data-state')).toBe('unknown');
    m.rerender(<AnimatedNumber value={undefined} />);
    expect(m.container.textContent).toBe('Unknown');
    m.unmount();
  });

  it('shows the first value without any roll or tint', () => {
    const m = mount(<AnimatedNumber value={1234} />);
    expect(m.container.querySelector('[data-roll]')).toBeNull();
    expect(m.container.querySelector('[data-tint]')).toBeNull();
    expect((m.container.firstElementChild as HTMLElement).getAttribute('data-state')).toBe('steady');
    m.unmount();
  });

  it('rolls only the changed digit, up when the value rose and down when it fell', () => {
    const m = mount(<AnimatedNumber value={1234} maxHz={0} />);
    m.rerender(<AnimatedNumber value={1235} maxHz={0} />);
    const rolling = m.container.querySelectorAll('[data-roll]');
    expect(rolling).toHaveLength(1);
    expect(rolling[0]?.getAttribute('data-roll')).toBe('up');
    expect(rolling[0]?.querySelector('.ui-number__in')?.textContent).toBe('5');
    expect(rolling[0]?.querySelector('.ui-number__out')?.textContent).toBe('4');
    expect(m.container.querySelector('.ui-number__live')?.getAttribute('data-tint')).toBe('up');
    expect(m.container.querySelector('.ui-sr-only')?.textContent).toBe('1,235');

    m.rerender(<AnimatedNumber value={1230} maxHz={0} />);
    expect(m.container.querySelector('[data-roll]')?.getAttribute('data-roll')).toBe('down');
    expect(m.container.querySelector('.ui-number__live')?.getAttribute('data-tint')).toBe('down');
    m.unmount();
  });

  it('swaps without a roll when roll is false (a seconds counter)', () => {
    const m = mount(<AnimatedNumber value={11} roll={false} maxHz={0} />);
    m.rerender(<AnimatedNumber value={12} roll={false} maxHz={0} />);
    expect(m.container.querySelector('[data-roll]')).toBeNull();
    expect(m.container.querySelector('[data-tint]')).toBeNull();
    expect(m.container.querySelector('.ui-sr-only')?.textContent).toBe('12');
    m.unmount();
  });

  it('under reduced motion swaps instantly and tints, with no roll', () => {
    html.dataset.motion = 'reduced';
    const m = mount(<AnimatedNumber value={1234} maxHz={0} />);
    expect((m.container.firstElementChild as HTMLElement).getAttribute('data-mode')).toBe('reduced');
    m.rerender(<AnimatedNumber value={1235} maxHz={0} />);
    expect(m.container.querySelector('[data-roll]')).toBeNull();
    expect(m.container.querySelector('.ui-number__live')?.getAttribute('data-tint')).toBe('up');
    m.unmount();
  });

  it('with motion off just swaps: no roll and no tint', () => {
    html.dataset.motion = 'off';
    const m = mount(<AnimatedNumber value={1234} maxHz={0} />);
    m.rerender(<AnimatedNumber value={1235} maxHz={0} />);
    expect(m.container.querySelector('[data-roll]')).toBeNull();
    expect(m.container.querySelector('[data-tint]')).toBeNull();
    expect(m.container.querySelector('.ui-sr-only')?.textContent).toBe('1,235');
    m.unmount();
  });

  it('forwards ref, className, style and other span attributes to the root', () => {
    const ref = createRef<HTMLSpanElement>();
    const m = mount(
      <AnimatedNumber ref={ref} value={5} font="mono" className="x" style={{ color: 'red' }} id="n" />,
    );
    expect(ref.current).toBe(m.container.firstElementChild);
    expect(ref.current?.className).toBe('ui-number x');
    expect(ref.current?.style.color).toBe('red');
    expect(ref.current?.id).toBe('n');
    expect(ref.current?.getAttribute('data-font')).toBe('mono');
    m.unmount();
  });
});

describe('FlashOnChange', () => {
  it('does not flash on the first render', () => {
    const m = mount(<FlashOnChange value={1}>x</FlashOnChange>);
    const el = m.container.firstElementChild as HTMLElement;
    expect(el.hasAttribute('data-flash')).toBe(false);
    expect(el.classList.contains('ui-flash')).toBe(true);
    m.unmount();
  });

  it('alternates a and b on every change so the animation restarts without a remount', () => {
    const m = mount(<FlashOnChange value={1}>x</FlashOnChange>);
    const el = m.container.firstElementChild as HTMLElement;
    m.rerender(<FlashOnChange value={2}>x</FlashOnChange>);
    expect(el.getAttribute('data-flash')).toBe('a');
    m.rerender(<FlashOnChange value={3}>x</FlashOnChange>);
    expect(el.getAttribute('data-flash')).toBe('b');
    m.rerender(<FlashOnChange value={3}>x</FlashOnChange>);
    expect(el.getAttribute('data-flash')).toBe('b');
    expect(m.container.firstElementChild).toBe(el);
    m.unmount();
  });

  it('reads auto as the direction of the change', () => {
    const m = mount(
      <FlashOnChange tone="auto" value={5}>
        x
      </FlashOnChange>,
    );
    const el = m.container.firstElementChild as HTMLElement;
    expect(el.getAttribute('data-tone')).toBe('accent');
    m.rerender(
      <FlashOnChange tone="auto" value={9}>
        x
      </FlashOnChange>,
    );
    expect(el.getAttribute('data-tone')).toBe('up');
    m.rerender(
      <FlashOnChange tone="auto" value={2}>
        x
      </FlashOnChange>,
    );
    expect(el.getAttribute('data-tone')).toBe('down');
    m.unmount();
  });

  it('renders as another element and forwards ref, className and style to it', () => {
    const ref = createRef<HTMLTableRowElement>();
    const m = mount(
      <table>
        <tbody>
          <FlashOnChange as="tr" variant="bar" value={1} ref={ref} className="row" style={{ color: 'red' }}>
            <td>cell</td>
          </FlashOnChange>
        </tbody>
      </table>,
    );
    expect(ref.current?.tagName).toBe('TR');
    expect(ref.current?.className).toBe('ui-flash row');
    expect(ref.current?.style.color).toBe('red');
    expect(ref.current?.getAttribute('data-variant')).toBe('bar');
    expect(ref.current?.hasAttribute('data-inline')).toBe(false);
    m.unmount();
  });

  it('is inline when it renders the default span', () => {
    const m = mount(<FlashOnChange value="a">x</FlashOnChange>);
    expect((m.container.firstElementChild as HTMLElement).hasAttribute('data-inline')).toBe(true);
    m.unmount();
  });

  it('marks the motion mode, and sets no flash at all when motion is off', () => {
    html.dataset.motion = 'off';
    const m = mount(<FlashOnChange value={1}>x</FlashOnChange>);
    m.rerender(<FlashOnChange value={2}>x</FlashOnChange>);
    const el = m.container.firstElementChild as HTMLElement;
    expect(el.getAttribute('data-mode')).toBe('off');
    expect(el.hasAttribute('data-flash')).toBe(false);
    m.unmount();
  });

  it('under reduced motion still marks the change, for the steady tint', () => {
    html.dataset.motion = 'reduced';
    const m = mount(<FlashOnChange value={1}>x</FlashOnChange>);
    m.rerender(<FlashOnChange value={2}>x</FlashOnChange>);
    const el = m.container.firstElementChild as HTMLElement;
    expect(el.getAttribute('data-mode')).toBe('reduced');
    expect(el.getAttribute('data-flash')).toBe('a');
    m.unmount();
  });
});

describe('Freshness', () => {
  it('is a status landmark with live announcements off, fresh for a recent update', () => {
    const m = mount(<Freshness ts={Date.now() - 2000} cadenceMs={4000} label="tip" />);
    const el = m.container.querySelector('[role="status"]') as HTMLElement;
    expect(el.getAttribute('aria-live')).toBe('off');
    expect(el.getAttribute('data-state')).toBe('fresh');
    expect(el.getAttribute('data-variant')).toBe('chip');
    expect(el.textContent).toMatch(/^tip (now|\d+ s)$/);
    expect(el.getAttribute('title')).toMatch(/^Last update \d/);
    m.unmount();
  });

  it('says Unknown without an update time', () => {
    const m = mount(<Freshness ts={null} cadenceMs={4000} label="nodes" />);
    const el = m.container.querySelector('[role="status"]') as HTMLElement;
    expect(el.textContent).toBe('nodes Unknown');
    expect(el.getAttribute('data-state')).toBe('unknown');
    expect(el.getAttribute('title')).toBe('No update seen yet');
    m.unmount();
  });

  it('carries a word for the bad states, not only a colour', () => {
    const stale = mount(<Freshness ts={Date.now() - 20_000} cadenceMs={4000} />);
    const el = stale.container.querySelector('[role="status"]') as HTMLElement;
    expect(el.getAttribute('data-state')).toBe('stale');
    expect(el.querySelector('.ui-fresh__word')?.textContent).toBe('stale');
    stale.unmount();

    const lost = mount(<Freshness ts={Date.now() - 60_000} cadenceMs={4000} />);
    const el2 = lost.container.querySelector('[role="status"]') as HTMLElement;
    expect(el2.getAttribute('data-state')).toBe('dead');
    expect(el2.querySelector('.ui-fresh__word')?.textContent).toBe('lost');
    lost.unmount();
  });

  it('exposes the age unit for stable-width styling', () => {
    const m = mount(<Freshness ts={Date.now() - 3 * 60_000} cadenceMs={90_000} />);
    expect(m.container.querySelector('.ui-fresh__age')?.getAttribute('data-unit')).toBe('min');
    m.unmount();
  });

  it('has an inline variant that reads as a sentence', () => {
    const m = mount(<Freshness variant="inline" ts={Date.now() - 12_000} cadenceMs={4000} label="tip" />);
    const el = m.container.querySelector('[role="status"]') as HTMLElement;
    expect(el.getAttribute('data-variant')).toBe('inline');
    expect(el.textContent).toBe('tip updated 12 s ago, stale');
    m.unmount();
  });

  it('only pings the dot after the update time changes', () => {
    const t = Date.now();
    const m = mount(<Freshness ts={t} cadenceMs={4000} />);
    const dot = () => m.container.querySelector('.ui-fresh__dot') as HTMLElement;
    expect(dot().hasAttribute('data-ping')).toBe(false);
    m.rerender(<Freshness ts={t + 4000} cadenceMs={4000} />);
    expect(dot().getAttribute('data-ping')).toBe('a');
    m.unmount();
  });

  it('forwards ref, className, style and a caller title', () => {
    const ref = createRef<HTMLSpanElement>();
    const m = mount(
      <Freshness
        ref={ref}
        ts={Date.now()}
        cadenceMs={4000}
        className="x"
        style={{ margin: 1 }}
        title="mine"
      />,
    );
    expect(ref.current).toBe(m.container.firstElementChild);
    expect(ref.current?.className).toBe('ui-fresh x');
    expect(ref.current?.style.margin).toBe('1px');
    expect(ref.current?.getAttribute('title')).toBe('mine');
    m.unmount();
  });
});

describe('LiveDot', () => {
  it('is decorative, pings by default only when ok', () => {
    const ok = mount(<LiveDot />);
    const dot = ok.container.firstElementChild as HTMLElement;
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    expect(dot.getAttribute('data-status')).toBe('ok');
    expect(dot.hasAttribute('data-ping')).toBe(true);
    ok.unmount();

    const warn = mount(<LiveDot status="warn" />);
    expect((warn.container.firstElementChild as HTMLElement).hasAttribute('data-ping')).toBe(false);
    warn.unmount();
  });

  it('sizes through --ui-dot and forwards ref, className and style', () => {
    const ref = createRef<HTMLSpanElement>();
    const m = mount(<LiveDot ref={ref} size={9} className="x" style={{ margin: 2 }} />);
    expect(ref.current).toBe(m.container.firstElementChild);
    expect(ref.current?.style.getPropertyValue('--ui-dot')).toBe('9px');
    expect(ref.current?.style.margin).toBe('2px');
    expect(ref.current?.className).toBe('ui-livedot x');
    m.unmount();
  });
});
