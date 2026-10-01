// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../controls/Button';
import { click, mount, press } from '../internal/testing';
import { Popover } from './Popover';
import { byRole, instantMotion, pointerDown } from './testUtils';

let restore: () => void;
beforeEach(() => {
  restore = instantMotion();
});
afterEach(() => {
  restore();
});

const trigger = (root: HTMLElement) => root.querySelector('button') as HTMLButtonElement;
const dialog = () => byRole('dialog')[0];

function Basic({ onOpenChange }: { onOpenChange?: (o: boolean) => void }) {
  return (
    <Popover
      aria-label="Filters"
      trigger={<Button>Filters</Button>}
      onOpenChange={onOpenChange}
      content={
        <div>
          <button type="button" id="first">
            First
          </button>
          <button type="button" id="last">
            Last
          </button>
        </div>
      }
    />
  );
}

describe('Popover', () => {
  it('starts closed with the trigger described as a popup', () => {
    const m = mount(<Basic />);
    const t = trigger(m.container);
    expect(t.getAttribute('aria-haspopup')).toBe('dialog');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(t.hasAttribute('aria-controls')).toBe(false);
    expect(dialog()).toBeUndefined();
    m.unmount();
  });

  it('opens on click into a named dialog in a portal, and wires the trigger to it', () => {
    const m = mount(<Basic />);
    const t = trigger(m.container);
    click(t);
    const d = dialog();
    expect(d).toBeDefined();
    expect(d?.getAttribute('aria-label')).toBe('Filters');
    expect(d?.parentElement).toBe(document.body);
    expect(t.getAttribute('aria-expanded')).toBe('true');
    expect(t.getAttribute('aria-controls')).toBe(d?.id);
    m.unmount();
  });

  it('moves focus to the first focusable element when it opens', () => {
    const m = mount(<Basic />);
    click(trigger(m.container));
    expect(document.activeElement?.id).toBe('first');
    m.unmount();
  });

  it('focuses the dialog itself when the content has nothing focusable', () => {
    const m = mount(<Popover aria-label="Info" trigger={<Button>Info</Button>} content={<p>Just text</p>} />);
    click(trigger(m.container));
    expect(document.activeElement).toBe(dialog());
    m.unmount();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const onOpenChange = vi.fn();
    const m = mount(<Basic onOpenChange={onOpenChange} />);
    click(trigger(m.container));
    press(document.activeElement as HTMLElement, 'Escape');
    expect(dialog()).toBeUndefined();
    expect(document.activeElement).toBe(trigger(m.container));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    m.unmount();
  });

  it('keeps the Escape key from reaching the window', () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    const m = mount(<Basic />);
    click(trigger(m.container));
    press(document.activeElement as HTMLElement, 'Escape');
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outer);
    m.unmount();
  });

  it('closes on a press outside without taking focus, and ignores presses inside', () => {
    const m = mount(
      <>
        <Basic />
        <input id="elsewhere" />
      </>,
    );
    click(trigger(m.container));
    pointerDown(document.getElementById('last') as HTMLElement);
    expect(dialog()).toBeDefined();
    const elsewhere = document.getElementById('elsewhere') as HTMLInputElement;
    elsewhere.focus();
    pointerDown(elsewhere);
    expect(dialog()).toBeUndefined();
    expect(document.activeElement).toBe(elsewhere);
    m.unmount();
  });

  it('toggles from the trigger', () => {
    const m = mount(<Basic />);
    click(trigger(m.container));
    expect(dialog()).toBeDefined();
    pointerDown(trigger(m.container));
    click(trigger(m.container));
    expect(dialog()).toBeUndefined();
    m.unmount();
  });

  it('can be controlled: it asks to close and the parent decides', () => {
    const onOpenChange = vi.fn();
    const m = mount(
      <Popover
        aria-label="x"
        open
        onOpenChange={onOpenChange}
        trigger={<Button>Open</Button>}
        content={<button type="button">In</button>}
      />,
    );
    expect(dialog()).toBeDefined();
    press(document.activeElement as HTMLElement, 'Escape');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(dialog()).toBeDefined();
    m.unmount();
  });

  it('gives a content function a close that returns focus to the trigger', () => {
    const m = mount(
      <Popover
        aria-label="x"
        trigger={<Button>Open</Button>}
        content={({ close }) => (
          <button type="button" id="done" onClick={close}>
            Done
          </button>
        )}
      />,
    );
    click(trigger(m.container));
    click(document.getElementById('done') as HTMLElement);
    expect(dialog()).toBeUndefined();
    expect(document.activeElement).toBe(trigger(m.container));
    m.unmount();
  });

  it('closes when Tab leaves the last element, and on Shift+Tab from the first', () => {
    const m = mount(<Basic />);
    click(trigger(m.container));
    (document.getElementById('last') as HTMLElement).focus();
    press(document.activeElement as HTMLElement, 'Tab');
    expect(dialog()).toBeUndefined();
    expect(document.activeElement).toBe(trigger(m.container));

    click(trigger(m.container));
    press(document.activeElement as HTMLElement, 'Tab', { shiftKey: true });
    expect(dialog()).toBeUndefined();
    expect(document.activeElement).toBe(trigger(m.container));
    m.unmount();
  });

  it('accepts a render function that receives the props to spread', () => {
    const m = mount(
      <Popover
        aria-label="x"
        trigger={(p) => (
          <button type="button" {...p}>
            Custom
          </button>
        )}
        content="Hello"
      />,
    );
    const t = trigger(m.container);
    expect(t.getAttribute('aria-haspopup')).toBe('dialog');
    click(t);
    expect(dialog()?.textContent).toBe('Hello');
    m.unmount();
  });

  it('runs the trigger element’s own click handler too', () => {
    const own = vi.fn();
    const m = mount(<Popover aria-label="x" trigger={<Button onClick={own}>Open</Button>} content="Hi" />);
    click(trigger(m.container));
    expect(own).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeDefined();
    m.unmount();
  });

  it('opens uncontrolled from defaultOpen', () => {
    const m = mount(<Popover aria-label="x" defaultOpen trigger={<Button>Open</Button>} content="Hi" />);
    expect(dialog()).toBeDefined();
    m.unmount();
  });

  it('nests: a press inside the inner layer keeps the outer one, and Escape closes only the inner', () => {
    function Nested() {
      const [innerOpen, setInnerOpen] = useState(true);
      return (
        <Popover
          aria-label="Outer"
          defaultOpen
          trigger={<Button>Outer</Button>}
          content={
            <Popover
              aria-label="Inner"
              open={innerOpen}
              onOpenChange={setInnerOpen}
              trigger={<Button>Inner trigger</Button>}
              content={
                <button type="button" id="inner-btn">
                  Inner
                </button>
              }
            />
          }
        />
      );
    }
    const m = mount(<Nested />);
    expect(byRole('dialog')).toHaveLength(2);
    pointerDown(document.getElementById('inner-btn') as HTMLElement);
    expect(byRole('dialog')).toHaveLength(2);
    press(document.activeElement as HTMLElement, 'Escape');
    expect(byRole('dialog').map((d) => d.getAttribute('aria-label'))).toEqual(['Outer']);
    m.unmount();
  });
});
