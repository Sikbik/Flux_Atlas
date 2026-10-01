// @vitest-environment jsdom
import { Server } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { click, mount } from '../internal/testing';
import { Card } from './Card';
import { Section } from './Section';
import { Row, Stack } from './Stack';
import { StatGrid } from './StatGrid';
import { ViewHeader } from './ViewHeader';

describe('ViewHeader', () => {
  it('renders the title as the page heading with the kind label, subtitle and actions', () => {
    const m = mount(
      <ViewHeader
        kind="Node"
        icon={Server}
        title="65.109.26.93:16147"
        mono
        subtitle="Stratus node in Helsinki"
        actions={<button type="button">Watch</button>}
      >
        <span>chip</span>
      </ViewHeader>,
    );
    const h = m.container.querySelector('h1');
    expect(h?.textContent).toBe('65.109.26.93:16147');
    expect(h?.hasAttribute('data-mono')).toBe(true);
    expect(m.container.querySelector('.ui-vh__kind')?.textContent).toBe('Node');
    expect(m.container.querySelector('.ui-vh__sub')?.textContent).toBe('Stratus node in Helsinki');
    expect(m.container.querySelector('.ui-vh__actions button')?.textContent).toBe('Watch');
    expect(m.container.querySelector('.ui-vh__meta span')?.textContent).toBe('chip');
    m.unmount();
  });

  it('puts the layout grid inside the container so its fold can respond to the header width', () => {
    const m = mount(<ViewHeader title="Block" />);
    const header = m.container.querySelector('.ui-vh');
    expect(header?.querySelector(':scope > .ui-vh__grid')).not.toBeNull();
    m.unmount();
  });

  it('wears the tier through data-tier and honours the heading level', () => {
    const m = mount(<ViewHeader title="Window title" tier="nimbus" level={2} />);
    expect(m.container.querySelector('.ui-vh')?.getAttribute('data-tier')).toBe('nimbus');
    expect(m.container.querySelector('h2')).not.toBeNull();
    expect(m.container.querySelector('h1')).toBeNull();
    m.unmount();
  });

  it('shows the freshness slot at the top right only when given one', () => {
    const m = mount(<ViewHeader title="Block" freshness={<span>tip 4 s</span>} />);
    expect(m.container.querySelector('.ui-vh__aside')?.textContent).toBe('tip 4 s');
    m.unmount();
    const n = mount(<ViewHeader title="Block" />);
    expect(n.container.querySelector('.ui-vh__aside')).toBeNull();
    n.unmount();
  });
});

describe('Section', () => {
  it('labels the region by its heading', () => {
    const m = mount(<Section title="Payment">body</Section>);
    const sec = m.container.querySelector('section');
    const heading = m.container.querySelector('h2');
    expect(heading?.textContent).toBe('Payment');
    expect(sec?.getAttribute('aria-labelledby')).toBe(heading?.id);
    m.unmount();
  });

  it('is open and not foldable by default', () => {
    const m = mount(<Section title="Payment">body</Section>);
    expect(m.container.querySelector('button')).toBeNull();
    expect(m.container.querySelector('.ui-section__body')?.hasAttribute('inert')).toBe(false);
    m.unmount();
  });

  it('folds and unfolds with aria-expanded, and makes folded content inert', () => {
    const onOpenChange = vi.fn();
    const m = mount(
      <Section title="Hardware" collapsible onOpenChange={onOpenChange}>
        <button type="button">inside</button>
      </Section>,
    );
    const toggle = m.container.querySelector<HTMLButtonElement>('.ui-section__toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    if (toggle) click(toggle);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(m.container.querySelector('.ui-section__body')?.hasAttribute('inert')).toBe(true);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    if (toggle) click(toggle);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(m.container.querySelector('.ui-section__body')?.hasAttribute('inert')).toBe(false);
    m.unmount();
  });

  it('starts folded with defaultOpen false and wires aria-controls to the body', () => {
    const m = mount(
      <Section title="Peers" collapsible defaultOpen={false}>
        peers
      </Section>,
    );
    const toggle = m.container.querySelector('.ui-section__toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    const controls = toggle?.getAttribute('aria-controls');
    expect(controls && m.container.querySelector(`[id="${controls}"]`)).not.toBeNull();
    m.unmount();
  });

  it('can be controlled from outside', () => {
    const m = mount(
      <Section title="Peers" collapsible open={false}>
        peers
      </Section>,
    );
    const toggle = m.container.querySelector<HTMLButtonElement>('.ui-section__toggle');
    if (toggle) click(toggle);
    // Controlled: the parent did not change `open`, so nothing moves.
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    m.unmount();
  });

  it('shows the aside and actions in the heading row', () => {
    const m = mount(
      <Section title="Payment" aside="updates every block" actions={<button type="button">Export</button>}>
        x
      </Section>,
    );
    expect(m.container.querySelector('.ui-section__aside')?.textContent).toBe('updates every block');
    expect(m.container.querySelector('.ui-section__side button')?.textContent).toBe('Export');
    m.unmount();
  });
});

describe('StatGrid', () => {
  it('passes the minimum tile width as a custom property', () => {
    const m = mount(<StatGrid min={180}>x</StatGrid>);
    const g = m.container.querySelector<HTMLElement>('.ui-stat-grid');
    expect(g?.style.getPropertyValue('--ui-stat-min')).toBe('180px');
    expect(g?.hasAttribute('data-fixed')).toBe(false);
    m.unmount();
  });

  it('can fix the column count', () => {
    const m = mount(<StatGrid columns={3}>x</StatGrid>);
    const g = m.container.querySelector<HTMLElement>('.ui-stat-grid');
    expect(g?.hasAttribute('data-fixed')).toBe(true);
    expect(g?.style.getPropertyValue('--ui-stat-cols')).toBe('3');
    m.unmount();
  });
});

describe('Card, Stack and Row', () => {
  it('sets padding, tone and glow as data attributes', () => {
    const m = mount(
      <Card padding="lg" tone="flat" glow>
        x
      </Card>,
    );
    const c = m.container.querySelector('.ui-card');
    expect(c?.getAttribute('data-padding')).toBe('lg');
    expect(c?.getAttribute('data-tone')).toBe('flat');
    expect(c?.hasAttribute('data-glow')).toBe(true);
    m.unmount();
  });

  it('only interactive cards carry the pointer light class', () => {
    const m = mount(
      <>
        <Card>a</Card>
        <Card interactive>b</Card>
      </>,
    );
    const cards = Array.from(m.container.querySelectorAll('.ui-card'));
    expect(cards[0]?.classList.contains('ui-spot')).toBe(false);
    expect(cards[1]?.classList.contains('ui-spot')).toBe(true);
    m.unmount();
  });

  it('maps gap steps onto the space tokens', () => {
    const m = mount(
      <>
        <Stack gap={7}>x</Stack>
        <Row gap={2}>y</Row>
      </>,
    );
    expect(m.container.querySelector<HTMLElement>('.ui-stack')?.style.getPropertyValue('--ui-gap')).toBe(
      'var(--space-7)',
    );
    expect(m.container.querySelector<HTMLElement>('.ui-row')?.style.getPropertyValue('--ui-gap')).toBe(
      'var(--space-2)',
    );
    m.unmount();
  });
});
