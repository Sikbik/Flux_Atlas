// @vitest-environment jsdom
import { Layers, Server } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from '../controls/Button';
import { click, mount, press } from '../internal/testing';
import { Menu, type MenuItem } from './Menu';
import { byRole, instantMotion, pointerClick, pointerMove } from './testUtils';

let restore: () => void;
beforeEach(() => {
  restore = instantMotion();
});
afterEach(() => {
  restore();
});

const trigger = (root: HTMLElement) => root.querySelector('button') as HTMLButtonElement;
const menu = () => byRole('menu')[0];
const rows = () => Array.from(document.body.querySelectorAll<HTMLElement>('[data-menu-row]'));
const active = () => rows().findIndex((r) => r.hasAttribute('data-active'));

function items(onSelect = vi.fn()): MenuItem[] {
  return [
    { id: 'globe', label: 'Globe', icon: Layers, shortcut: ['G'], onSelect },
    { id: 'nodes', label: 'Nodes', icon: Server, shortcut: ['N'], onSelect },
    { id: 'apps', label: 'Apps', disabled: true, onSelect },
    { id: 'explorer', label: 'Explorer', shortcut: ['E'], onSelect },
  ];
}

describe('Menu', () => {
  it('starts closed with the trigger described as a menu button', () => {
    const m = mount(<Menu trigger={<Button>View</Button>} items={items()} />);
    const t = trigger(m.container);
    expect(t.getAttribute('aria-haspopup')).toBe('menu');
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(menu()).toBeUndefined();
    m.unmount();
  });

  it('opens from the keyboard onto the first row, named by its trigger', () => {
    const m = mount(<Menu trigger={<Button>View</Button>} items={items()} />);
    const t = trigger(m.container);
    click(t);
    expect(menu()).toBeDefined();
    expect(menu()?.getAttribute('aria-labelledby')).toBe(t.id);
    expect(t.getAttribute('aria-expanded')).toBe('true');
    expect(t.getAttribute('aria-controls')).toBe(menu()?.id);
    expect(active()).toBe(0);
    expect(document.activeElement).toBe(rows()[0]);
    m.unmount();
  });

  it('opens from a pointer without highlighting a row, and arrows then start at the ends', () => {
    const m = mount(<Menu trigger={<Button>View</Button>} items={items()} />);
    pointerClick(trigger(m.container));
    expect(active()).toBe(-1);
    expect(document.activeElement).toBe(menu());
    press(menu() as HTMLElement, 'ArrowDown');
    expect(active()).toBe(0);
    m.unmount();
  });

  it('opens on ArrowDown at the first row and on ArrowUp at the last', () => {
    const m = mount(<Menu trigger={<Button>View</Button>} items={items()} />);
    press(trigger(m.container), 'ArrowDown');
    expect(active()).toBe(0);
    press(document.activeElement as HTMLElement, 'Escape');
    press(trigger(m.container), 'ArrowUp');
    expect(active()).toBe(3);
    m.unmount();
  });

  it('moves with arrows, skips disabled rows, and jumps with Home and End', () => {
    const m = mount(<Menu trigger={<Button>View</Button>} items={items()} />);
    click(trigger(m.container));
    const key = (k: string) => press(document.activeElement as HTMLElement, k);
    key('ArrowDown');
    expect(active()).toBe(1);
    key('ArrowDown');
    expect(active()).toBe(3);
    key('ArrowDown');
    expect(active()).toBe(0);
    key('ArrowUp');
    expect(active()).toBe(3);
    key('Home');
    expect(active()).toBe(0);
    key('End');
    expect(active()).toBe(3);
    m.unmount();
  });

  it('jumps to a row by typing its first letters', () => {
    const m = mount(<Menu trigger={<Button>View</Button>} items={items()} />);
    click(trigger(m.container));
    press(document.activeElement as HTMLElement, 'e');
    expect(rows()[active()]?.textContent).toContain('Explorer');
    m.unmount();
  });

  it('highlights and focuses a row under the pointer', () => {
    const m = mount(<Menu trigger={<Button>View</Button>} items={items()} />);
    click(trigger(m.container));
    pointerMove(rows()[3] as HTMLElement);
    expect(active()).toBe(3);
    expect(document.activeElement).toBe(rows()[3]);
    pointerMove(rows()[2] as HTMLElement);
    expect(active()).toBe(3);
    m.unmount();
  });

  it('chooses a row: closes, returns focus to the trigger, then runs onSelect', () => {
    // Focus is back on the trigger by the time the action runs, so an action may move it elsewhere.
    const focusAtSelect: Array<Element | null> = [];
    const onSelect = vi.fn(() => focusAtSelect.push(document.activeElement));
    const m = mount(<Menu trigger={<Button>View</Button>} items={items(onSelect)} />);
    click(trigger(m.container));
    click(rows()[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(focusAtSelect[0]).toBe(trigger(m.container));
    expect(menu()).toBeUndefined();
    m.unmount();
  });

  it('ignores a disabled row', () => {
    const onSelect = vi.fn();
    const m = mount(<Menu trigger={<Button>View</Button>} items={items(onSelect)} />);
    click(trigger(m.container));
    expect(rows()[2]?.getAttribute('aria-disabled')).toBe('true');
    click(rows()[2] as HTMLElement);
    expect(onSelect).not.toHaveBeenCalled();
    expect(menu()).toBeDefined();
    m.unmount();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const m = mount(<Menu trigger={<Button>View</Button>} items={items()} />);
    click(trigger(m.container));
    press(document.activeElement as HTMLElement, 'Escape');
    expect(menu()).toBeUndefined();
    expect(document.activeElement).toBe(trigger(m.container));
    m.unmount();
  });

  it('closes on Tab and leaves focus on the trigger for the browser to move on from', () => {
    const m = mount(<Menu trigger={<Button>View</Button>} items={items()} />);
    click(trigger(m.container));
    press(document.activeElement as HTMLElement, 'Tab');
    expect(menu()).toBeUndefined();
    expect(document.activeElement).toBe(trigger(m.container));
    m.unmount();
  });

  it('shows key caps and icons, and keeps labels aligned when any row has a leading icon', () => {
    const m = mount(<Menu trigger={<Button>View</Button>} items={items()} />);
    click(trigger(m.container));
    expect(menu()?.hasAttribute('data-lead')).toBe(true);
    expect(rows().every((r) => r.querySelector('.ui-menu__lead'))).toBe(true);
    expect(Array.from(rows()[0]?.querySelectorAll('kbd') ?? []).map((k) => k.textContent)).toEqual(['G']);
    m.unmount();
  });

  it('draws separators and labelled groups with the right roles', () => {
    const m = mount(
      <Menu
        trigger={<Button>Window</Button>}
        items={[
          { type: 'label', label: 'Windows' },
          { id: 'a', label: 'Nodes', onSelect: () => {} },
          { type: 'separator' },
          { type: 'label', label: 'Layers' },
          { id: 'b', label: 'Weather', onSelect: () => {} },
        ]}
      />,
    );
    click(trigger(m.container));
    const groups = byRole('group');
    expect(groups).toHaveLength(2);
    expect(
      groups.map((g) => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent),
    ).toEqual(['Windows', 'Layers']);
    expect(document.body.querySelectorAll('hr.ui-menu__sep')).toHaveLength(1);
    m.unmount();
  });

  it('makes a row with checked a checkbox item and shows the check', () => {
    const m = mount(
      <Menu
        trigger={<Button>Layers</Button>}
        items={[
          { id: 'peers', label: 'Peers', checked: true, onSelect: () => {} },
          { id: 'weather', label: 'Weather', checked: false, onSelect: () => {} },
        ]}
      />,
    );
    click(trigger(m.container));
    const boxes = byRole('menuitemcheckbox');
    expect(boxes.map((b) => b.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(boxes[0]?.querySelector('svg')).not.toBeNull();
    expect(boxes[1]?.querySelector('svg')).toBeNull();
    m.unmount();
  });

  it('marks danger rows', () => {
    const m = mount(
      <Menu
        trigger={<Button>More</Button>}
        items={[{ id: 'rm', label: 'Stop watching', danger: true, onSelect: () => {} }]}
      />,
    );
    click(trigger(m.container));
    expect(rows()[0]?.hasAttribute('data-danger')).toBe(true);
    m.unmount();
  });

  it('works behind an icon button (a row-actions kebab) and uses an explicit name', () => {
    const m = mount(
      <Menu
        aria-label="Node actions"
        trigger={<IconButton icon={Layers} label="Actions" />}
        items={[{ id: 'open', label: 'Open node', onSelect: () => {} }]}
      />,
    );
    click(trigger(m.container));
    expect(menu()?.getAttribute('aria-label')).toBe('Node actions');
    expect(menu()?.hasAttribute('aria-labelledby')).toBe(false);
    m.unmount();
  });

  it('can be controlled', () => {
    const onOpenChange = vi.fn();
    const m = mount(
      <Menu open onOpenChange={onOpenChange} trigger={<Button>View</Button>} items={items()} />,
    );
    expect(menu()).toBeDefined();
    press(document.activeElement as HTMLElement, 'Escape');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(menu()).toBeDefined();
    m.unmount();
  });
});
