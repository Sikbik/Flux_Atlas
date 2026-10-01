import { describe, expect, it, vi } from 'vitest';
import { createWindowManager, loadMemory, WM_STORAGE_KEY, type WmKeyEvent, wmKeyHandler } from './store';

function fakeStorage(init: Record<string, string> = {}) {
  const data = { ...init };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const throwing = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

function key(k: string, o: Partial<WmKeyEvent> = {}): WmKeyEvent & { prevented: boolean } {
  const e = {
    key: k,
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    target: null,
    prevented: false,
    preventDefault() {
      e.prevented = true;
    },
    ...o,
  };
  return e;
}

describe('store', () => {
  it('notifies subscribers only on change and fills in the clock', () => {
    const wm = createWindowManager({ storage: null, now: () => 42 });
    const fn = vi.fn();
    const off = wm.subscribe(fn);
    wm.dispatch({ t: 'open', type: 'settings', key: null });
    expect(wm.getState().windows['settings:']!.openedAt).toBe(42);
    wm.dispatch({ t: 'focus', id: 'settings:' });
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    wm.dispatch({ t: 'close', id: 'settings:' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('persists placement memory and restores it in a new session', () => {
    const storage = fakeStorage();
    const a = createWindowManager({ storage });
    a.dispatch({ t: 'open', type: 'terminal', key: null });
    a.dispatch({ t: 'nudge', id: 'terminal:', dx: 64, dy: -64, dw: 32, dh: 0 });
    const rect = a.getState().windows['terminal:']!.rect;
    expect(JSON.parse(storage.data[WM_STORAGE_KEY]!).memory.terminal.rect).toEqual(rect);
    const b = createWindowManager({ storage });
    b.dispatch({ t: 'open', type: 'terminal', key: null });
    expect(b.getState().windows['terminal:']!.rect).toEqual(rect);
  });

  it('survives a throwing storage', () => {
    const wm = createWindowManager({ storage: throwing });
    expect(() => {
      wm.dispatch({ t: 'open', type: 'terminal', key: null });
      wm.dispatch({ t: 'nudge', id: 'terminal:', dx: 10, dy: 0, dw: 0, dh: 0 });
    }).not.toThrow();
    expect(wm.getState().memory.terminal).toBeDefined();
  });

  it('drops malformed persisted entries', () => {
    const storage = fakeStorage({
      [WM_STORAGE_KEY]: JSON.stringify({
        memory: {
          terminal: { placement: 'docked', rect: { x: 0, y: 0, w: 100, h: 100 }, dockWidth: 400 },
          bogus: { placement: 'floating', rect: { x: 0, y: 0, w: 100, h: 100 }, dockWidth: 400 },
          app: { placement: 'floating', rect: { x: 0, y: 0, w: -1, h: 100 }, dockWidth: 400 },
          node: { placement: 'docked', rect: { x: 0, y: 0, w: 400, h: 400 }, dockWidth: 500 },
        },
      }),
    });
    expect(Object.keys(loadMemory(storage))).toEqual(['node']);
    expect(loadMemory(fakeStorage({ [WM_STORAGE_KEY]: '{not json' }))).toEqual({});
  });
});

describe('keyboard', () => {
  it('Esc lets onEscape consume first (clearing the selection), then closes the topmost window', () => {
    const wm = createWindowManager({ storage: null });
    wm.dispatch({ t: 'open', type: 'block', key: '1' });
    wm.dispatch({ t: 'open', type: 'settings', key: null });
    let selection = true;
    const onKey = wmKeyHandler(wm, {
      onEscape: () => {
        if (!selection) return false;
        selection = false;
        return true;
      },
    });
    const e1 = key('Escape');
    expect(onKey(e1)).toBe(true);
    expect(e1.prevented).toBe(true);
    expect(Object.keys(wm.getState().windows).length).toBe(2);
    onKey(key('Escape'));
    expect(Object.keys(wm.getState().windows)).toEqual(['block:1']);
    onKey(key('Escape'));
    expect(onKey(key('Escape'))).toBe(false);
  });

  it('Esc on a route-bound window navigates instead of closing it directly', () => {
    const wm = createWindowManager({ storage: null });
    wm.dispatch({ t: 'syncRoute', primary: { type: 'node', key: '1' }, extras: [] });
    const onCloseRoute = vi.fn();
    wmKeyHandler(wm, { onCloseRoute })(key('Escape'));
    expect(onCloseRoute).toHaveBeenCalledWith(expect.objectContaining({ id: 'node:1' }));
    expect(wm.getState().windows['node:1']).toBeDefined();
  });

  it('Alt+Arrow moves the focused floating window, Shift moves further, Ctrl resizes', () => {
    const wm = createWindowManager({ storage: null });
    wm.dispatch({ t: 'open', type: 'terminal', key: null });
    const onKey = wmKeyHandler(wm);
    const r = wm.getState().windows['terminal:']!.rect;
    expect(onKey(key('ArrowRight', { altKey: true }))).toBe(true);
    expect(wm.getState().windows['terminal:']!.rect.x).toBe(r.x + 16);
    onKey(key('ArrowUp', { altKey: true, shiftKey: true }));
    expect(wm.getState().windows['terminal:']!.rect.y).toBe(r.y - 64);
    onKey(key('ArrowLeft', { altKey: true, ctrlKey: true }));
    expect(wm.getState().windows['terminal:']!.rect.w).toBe(r.w - 16);
    expect(onKey(key('ArrowRight'))).toBe(false);
  });

  it('Alt+Ctrl+Left widens the docked inspector', () => {
    const wm = createWindowManager({ storage: null });
    wm.dispatch({ t: 'open', type: 'node', key: '1' });
    wmKeyHandler(wm)(key('ArrowLeft', { altKey: true, ctrlKey: true }));
    expect(wm.getState().windows['node:1']!.dockWidth).toBe(436);
  });

  it('Alt+backquote cycles, Alt+D docks, Alt+Enter maximizes, Alt+M minimizes', () => {
    const wm = createWindowManager({ storage: null });
    wm.dispatch({ t: 'open', type: 'app', key: 'x', now: 1 });
    wm.dispatch({ t: 'open', type: 'block', key: '1', now: 2 });
    const onKey = wmKeyHandler(wm);
    onKey(key('`', { altKey: true, code: 'Backquote' }));
    expect(wm.getState().focused).toBe('app:x');
    onKey(key('d', { altKey: true, code: 'KeyD' }));
    expect(wm.getState().windows['app:x']!.placement).toBe('floating');
    onKey(key('Enter', { altKey: true }));
    expect(wm.getState().windows['app:x']!.mode).toBe('maximized');
    onKey(key('Enter', { altKey: true }));
    expect(wm.getState().windows['app:x']!.mode).toBe('normal');
    onKey(key('m', { altKey: true, code: 'KeyM' }));
    expect(wm.getState().windows['app:x']!.mode).toBe('minimized');
  });

  it('ignores window keys while typing in a field; Esc blurs the field', () => {
    const wm = createWindowManager({ storage: null });
    wm.dispatch({ t: 'open', type: 'settings', key: null });
    const onKey = wmKeyHandler(wm);
    const input = { tagName: 'INPUT', blur: vi.fn() } as unknown as EventTarget;
    expect(onKey(key('ArrowRight', { altKey: true, target: input }))).toBe(false);
    expect(onKey(key('Escape', { target: input }))).toBe(true);
    expect((input as unknown as { blur: () => void }).blur).toHaveBeenCalled();
    expect(wm.getState().windows['settings:']).toBeDefined();
    const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
    expect(onKey(key('m', { altKey: true, target: editable }))).toBe(false);
  });
});
