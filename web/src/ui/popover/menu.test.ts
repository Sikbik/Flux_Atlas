import { describe, expect, it } from 'vitest';
import { buildMenu, type MenuItem } from './menu';

const a = (id: string, extra: Partial<Extract<MenuItem, { id: string; label: string }>> = {}): MenuItem => ({
  id,
  label: id.toUpperCase(),
  onSelect: () => {},
  ...extra,
});

describe('buildMenu', () => {
  it('numbers the actions in display order across groups', () => {
    const { blocks, actions } = buildMenu([a('one'), a('two'), { type: 'separator' }, a('three')]);
    expect(actions.map((x) => x.id)).toEqual(['one', 'two', 'three']);
    const groups = blocks.flatMap((b) => (b.kind === 'group' ? [b.entries.map((e) => e.index)] : []));
    expect(groups).toEqual([[0, 1], [2]]);
    expect(blocks.map((b) => b.kind)).toEqual(['group', 'separator', 'group']);
  });

  it('starts a labelled group at a label', () => {
    const { blocks } = buildMenu([{ type: 'label', label: 'Windows' }, a('nodes'), a('apps')]);
    const group = blocks[0];
    expect(group?.kind).toBe('group');
    if (group?.kind === 'group') {
      expect(group.label?.text).toBe('Windows');
      expect(group.entries).toHaveLength(2);
    }
  });

  it('drops leading, trailing and repeated separators', () => {
    const { blocks } = buildMenu([
      { type: 'separator' },
      a('one'),
      { type: 'separator' },
      { type: 'separator' },
      a('two'),
      { type: 'separator' },
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(['group', 'separator', 'group']);
  });

  it('does not draw empty groups', () => {
    const { blocks, actions } = buildMenu([
      { type: 'label', label: 'Empty' },
      { type: 'separator' },
      { type: 'label', label: 'Full' },
      a('one'),
    ]);
    expect(actions).toHaveLength(1);
    expect(blocks).toHaveLength(1);
    const only = blocks[0];
    expect(only?.kind === 'group' && only.label?.text).toBe('Full');
  });

  it('keeps disabled actions in the flat list so indices match the DOM', () => {
    const { actions } = buildMenu([a('one'), a('two', { disabled: true }), a('three')]);
    expect(actions.map((x) => x.disabled ?? false)).toEqual([false, true, false]);
  });

  it('is empty for no items', () => {
    const m = buildMenu([]);
    expect(m.blocks).toEqual([]);
    expect(m.actions).toEqual([]);
  });
});
