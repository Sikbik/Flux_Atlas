// @vitest-environment jsdom
// A result row fades in only if it arrives after the list is up: `enter` is read once, when the row mounts,
// so rows that were there when the palette opened never start a fade later.

import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '../../../ui/internal/testing';
import { RowView } from './rows';
import type { PaletteRow } from './types';

const ROW: PaletteRow = {
  id: 'act:globe',
  group: 'try',
  kind: 'action',
  icon: 'globe',
  title: 'Open the globe',
  chip: 'Action',
  score: 1,
  action: { type: 'run', id: 'view.globe' },
};

const el = (root: ParentNode) => root.querySelector('.pal-row') as HTMLElement;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RowView enter', () => {
  it('fades by default (the results page, and rows that arrive later)', () => {
    const m = mount(<RowView row={ROW} q="" active={false} onPick={() => {}} />);
    expect(el(m.container).hasAttribute('data-enter')).toBe(true);
    m.unmount();
  });

  it('does not fade a row that mounts while the list is still arriving', () => {
    const m = mount(<RowView row={ROW} q="" active={false} enter={false} onPick={() => {}} />);
    expect(el(m.container).hasAttribute('data-enter')).toBe(false);
    m.unmount();
  });

  it('keeps what it was at mount: the flag turning true later does not start a fade on a row already there', () => {
    const m = mount(<RowView row={ROW} q="" active={false} enter={false} onPick={() => {}} />);
    m.rerender(<RowView row={ROW} q="" active={false} enter onPick={() => {}} />);
    expect(el(m.container).hasAttribute('data-enter')).toBe(false);
    m.unmount();
  });

  it('applies to the button form too', () => {
    const m = mount(<RowView row={ROW} q="" active={false} enter={false} as="button" onPick={() => {}} />);
    const b = m.container.querySelector('button.pal-row') as HTMLElement;
    expect(b).not.toBeNull();
    expect(b.hasAttribute('data-enter')).toBe(false);
    m.unmount();
  });
});
