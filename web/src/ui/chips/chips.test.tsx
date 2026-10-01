// @vitest-environment jsdom
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { click, mount } from '../internal/testing';
import { Badge } from './Badge';
import { Chip } from './Chip';
import { StatusChip } from './StatusChip';
import { TierChip } from './TierChip';
import { litCapsules, TierGlyph, tierDescription } from './TierGlyph';

describe('litCapsules', () => {
  it('lights one, two or three capsules for Cumulus, Nimbus and Stratus, and none otherwise', () => {
    expect(litCapsules('cumulus')).toBe(1);
    expect(litCapsules('nimbus')).toBe(2);
    expect(litCapsules('stratus')).toBe(3);
    expect(litCapsules('unknown')).toBe(0);
    expect(litCapsules(null)).toBe(0);
    expect(litCapsules(undefined)).toBe(0);
  });

  it('describes a tier for assistive technology', () => {
    expect(tierDescription('stratus')).toBe('Stratus, tier 3 of 3');
    expect(tierDescription('cumulus')).toBe('Cumulus, tier 1 of 3');
  });
});

describe('TierGlyph', () => {
  it('is decorative unless given a label', () => {
    const m = mount(<TierGlyph tier="nimbus" />);
    const svg = m.container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(m.container.querySelectorAll('[data-lit]').length).toBe(2);
    m.unmount();
  });

  it('becomes an image with a name when labelled', () => {
    const m = mount(<TierGlyph tier="stratus" label="Stratus tier" />);
    const svg = m.container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('Stratus tier');
    m.unmount();
  });

  it('forwards ref, className, style and data attributes to the svg', () => {
    const ref = createRef<SVGSVGElement>();
    const m = mount(<TierGlyph ref={ref} tier="nimbus" className="x" style={{ margin: 2 }} data-test="y" />);
    expect(ref.current).toBe(m.container.querySelector('svg'));
    expect(ref.current?.getAttribute('class')).toBe('ui-tier-glyph x');
    expect(ref.current?.style.margin).toBe('2px');
    expect(ref.current?.getAttribute('data-test')).toBe('y');
    expect(ref.current?.getAttribute('data-tier')).toBe('nimbus');
    m.unmount();
  });
});

describe('Chip', () => {
  it('is a static span by default', () => {
    const m = mount(<Chip>Germany</Chip>);
    expect(m.container.querySelector('span.ui-chip')?.textContent).toBe('Germany');
    expect(m.container.querySelector('button')).toBeNull();
    m.unmount();
  });

  it('becomes a toggle button with aria-pressed when given onClick', () => {
    const onClick = vi.fn();
    const m = mount(
      <Chip selected onClick={onClick}>
        Stratus
      </Chip>,
    );
    const b = m.container.querySelector('button');
    expect(b?.getAttribute('aria-pressed')).toBe('true');
    if (b) click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  it('reports an unselected toggle as aria-pressed false, not absent', () => {
    const m = mount(<Chip onClick={() => undefined}>Nimbus</Chip>);
    expect(m.container.querySelector('button')?.hasAttribute('aria-pressed')).toBe(true);
    m.unmount();
  });
});

describe('TierChip', () => {
  it('shows the tier word with the glyph', () => {
    const m = mount(<TierChip tier="stratus" />);
    expect(m.container.textContent).toBe('Stratus');
    expect(m.container.querySelector('svg')).not.toBeNull();
    expect(m.container.querySelector('[data-tier="stratus"]')).not.toBeNull();
    m.unmount();
  });

  it('never guesses: unknown, null and undefined say Unknown', () => {
    for (const t of ['unknown', null, undefined] as const) {
      const m = mount(<TierChip tier={t} />);
      expect(m.container.textContent).toBe('Unknown');
      expect(m.container.querySelector('[data-tier="unknown"]')).not.toBeNull();
      m.unmount();
    }
  });

  it('can carry a payout amount and the operator ring', () => {
    const m = mount(<TierChip tier="cumulus" amount="+1.00" mine />);
    expect(m.container.textContent).toBe('Cumulus+1.00');
    expect(m.container.querySelector('[data-mine]')).not.toBeNull();
    m.unmount();
  });
});

describe('StatusChip', () => {
  it('pairs an icon with a word, never colour alone', () => {
    const m = mount(<StatusChip status="confirmed" />);
    expect(m.container.textContent).toBe('Confirmed');
    expect(m.container.querySelector('svg')).not.toBeNull();
    expect(m.container.querySelector('[data-status="ok"]')).not.toBeNull();
    m.unmount();
  });

  it('draws pending in its own role, not as confirmed', () => {
    const m = mount(<StatusChip status="pending" />);
    expect(m.container.querySelector('[data-status="pending"]')).not.toBeNull();
    expect(m.container.querySelector('[data-status="ok"]')).toBeNull();
    m.unmount();
  });

  it('shows Unknown for a value it does not recognise', () => {
    const m = mount(<StatusChip status="made-up" />);
    expect(m.container.textContent).toBe('Unknown');
    m.unmount();
  });

  it('accepts a custom label and the badge variant', () => {
    const m = mount(<StatusChip status="live" variant="badge" label="Live 41 ms" />);
    expect(m.container.textContent).toContain('Live 41 ms');
    expect(m.container.querySelector('[data-variant="badge"]')).not.toBeNull();
    m.unmount();
  });
});

describe('Badge', () => {
  it('maps a status tone onto the status role and leaves accent and neutral alone', () => {
    const m = mount(
      <>
        <Badge tone="crit">DoS</Badge>
        <Badge tone="accent">New</Badge>
        <Badge>Beta</Badge>
      </>,
    );
    const badges = Array.from(m.container.querySelectorAll('.ui-chip'));
    expect(badges[0]?.getAttribute('data-status')).toBe('crit');
    expect(badges[1]?.getAttribute('data-tone')).toBe('accent');
    expect(badges[2]?.getAttribute('data-tone')).toBe('neutral');
    m.unmount();
  });
});
