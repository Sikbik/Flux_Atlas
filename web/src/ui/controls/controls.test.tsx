// @vitest-environment jsdom
import { Plus } from 'lucide-react';
import { act, createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, mount } from '../internal/testing';
import { Button, IconButton } from './Button';
import { CopyButton } from './CopyButton';
import { Kbd, KbdCombo } from './Kbd';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('Button', () => {
  it('is a real button of type button that fires onClick', () => {
    const onClick = vi.fn();
    const m = mount(<Button onClick={onClick}>Go</Button>);
    const b = m.container.querySelector('button');
    expect(b?.type).toBe('button');
    if (b) click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  it('carries variant, size and pill as data attributes', () => {
    const m = mount(
      <Button variant="primary" size="sm" pill>
        Go
      </Button>,
    );
    const b = m.container.querySelector('button');
    expect(b?.getAttribute('data-variant')).toBe('primary');
    expect(b?.getAttribute('data-size')).toBe('sm');
    expect(b?.hasAttribute('data-pill')).toBe(true);
    m.unmount();
  });

  it('is busy while loading and ignores presses', () => {
    const onClick = vi.fn();
    const m = mount(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const b = m.container.querySelector('button');
    expect(b?.getAttribute('aria-busy')).toBe('true');
    if (b) click(b);
    expect(onClick).not.toHaveBeenCalled();
    m.unmount();
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    const m = mount(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    const b = m.container.querySelector('button');
    expect(b?.disabled).toBe(true);
    if (b) click(b);
    expect(onClick).not.toHaveBeenCalled();
    m.unmount();
  });
});

describe('IconButton', () => {
  it('always has an accessible name', () => {
    const m = mount(<IconButton icon={Plus} label="Add node" />);
    const b = m.container.querySelector('button');
    expect(b?.getAttribute('aria-label')).toBe('Add node');
    expect(b?.getAttribute('title')).toBe('Add node');
    m.unmount();
  });
});

describe('CopyButton', () => {
  it('copies the exact value, announces it politely from outside the button, and resets', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onCopied = vi.fn();
    const m = mount(<CopyButton value="the-full-value" what="block hash" onCopied={onCopied} />);
    const b = m.container.querySelector('button');
    expect(b?.getAttribute('aria-label')).toBe('Copy block hash');
    await act(async () => {
      b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(writeText).toHaveBeenCalledWith('the-full-value');
    expect(onCopied).toHaveBeenCalledTimes(1);
    expect(b?.getAttribute('data-state')).toBe('copied');
    const live = m.container.querySelector('[role="status"]');
    expect(live?.textContent).toBe('Copied');
    // The live region is a sibling of the button: a button's children are not announced.
    expect(b?.contains(live ?? null)).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(b?.getAttribute('data-state')).toBe('idle');
    expect(live?.textContent).toBe('');
    m.unmount();
  });

  it('says so when every copy method fails', async () => {
    const exec = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    const m = mount(<CopyButton value="x" />);
    const b = m.container.querySelector('button');
    await act(async () => {
      b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(b?.getAttribute('data-state')).toBe('failed');
    expect(m.container.querySelector('[role="status"]')?.textContent).toBe('Copy failed');
    m.unmount();
  });
});

describe('Kbd', () => {
  it('renders a keycap', () => {
    const m = mount(<Kbd>Esc</Kbd>);
    expect(m.container.querySelector('kbd')?.textContent).toBe('Esc');
    m.unmount();
  });

  it('KbdCombo draws each key and speaks the combination for screen readers', () => {
    const m = mount(<KbdCombo keys={['Ctrl', 'K']} />);
    expect(m.container.querySelectorAll('kbd').length).toBe(2);
    expect(m.container.querySelector('.ui-kbd-combo__sr')?.textContent).toMatch(/Ctrl.*K/);
    m.unmount();
  });

  it('KbdCombo forwards ref, className, style and data attributes to its root', () => {
    const ref = createRef<HTMLSpanElement>();
    const m = mount(<KbdCombo ref={ref} keys={['K']} className="x" style={{ margin: 3 }} data-test="y" />);
    expect(ref.current).toBe(m.container.firstElementChild);
    expect(ref.current?.className).toBe('ui-kbd-combo x');
    expect(ref.current?.style.margin).toBe('3px');
    expect(ref.current?.getAttribute('data-test')).toBe('y');
    m.unmount();
  });
});
