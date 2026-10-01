import { describe, expect, it, vi } from 'vitest';
import { type LauncherId, PALETTE_SEED, runLauncher } from './launchers';
import type { ShellNav } from './nav';

function env(open: { id: string; type: string; key: string | null; binding: string } | null = null) {
  const palette = vi.fn();
  const open_ = vi.fn();
  const focus = vi.fn();
  const nav = {
    here: () => ({ path: '/', search: {}, extras: [], primary: null }),
    go: vi.fn(),
    open: open_,
    globe: vi.fn(),
    palette,
    patchSearch: vi.fn(),
  } as unknown as ShellNav;
  const run = (id: LauncherId) =>
    runLauncher(id, {
      nav,
      openWindowOfType: () => open as never,
      focus,
      tipHeight: () => 2_998_000,
    });
  return { run, palette, open: open_, focus };
}

describe('the launchers that need a subject', () => {
  it('open the palette on their kind: the apps prefix lists apps, the node prefix the next payees', () => {
    const e = env();
    e.run('apps');
    e.run('nodes');
    e.run('operator');
    expect(e.palette.mock.calls).toEqual([['app '], ['node '], ['operator ']]);
  });

  it('raise the window instead when one is open', () => {
    const e = env({ id: 'w1', type: 'app', key: 'Fluxtracker', binding: 'primary' });
    e.run('apps');
    expect(e.palette).not.toHaveBeenCalled();
    expect(e.focus).toHaveBeenCalledWith('w1');
  });

  it('seed only the kinds that need a subject', () => {
    expect(Object.keys(PALETTE_SEED).sort()).toEqual(['apps', 'nodes', 'operator']);
    for (const seed of Object.values(PALETTE_SEED)) expect(seed).toMatch(/^[a-z]+ $/);
  });
});
