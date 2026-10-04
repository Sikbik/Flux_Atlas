import { describe, expect, it, vi } from 'vitest';
import { LAUNCHERS, type LauncherId, runLauncher } from './launchers';
import type { ShellNav } from './nav';

function env(
  open: { id: string; type: string; key: string | null; binding: string } | null = null,
  front: string | null = null,
) {
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
      isFront: (windowId) => windowId === front,
    });
  return { run, palette, open: open_, focus };
}

describe('the hub launchers', () => {
  it('open the hub of their kind, not the palette: Nodes the node hub, Apps the app hub', () => {
    const e = env();
    e.run('nodes');
    e.run('apps');
    expect(e.open.mock.calls).toEqual([[{ type: 'nodes', key: null }], [{ type: 'apps', key: null }]]);
    expect(e.palette).not.toHaveBeenCalled();
  });

  it('raise the window instead when one is open', () => {
    const e = env({ id: 'w1', type: 'app', key: 'Fluxtracker', binding: 'primary' });
    e.run('apps');
    expect(e.open).not.toHaveBeenCalled();
    expect(e.focus).toHaveBeenCalledWith('w1');
  });

  it('go home to the hub when the open window is already in front, which raising would not change', () => {
    const e = env({ id: 'node:abc', type: 'node', key: 'abc', binding: 'primary' }, 'node:abc');
    e.run('nodes');
    expect(e.focus).not.toHaveBeenCalled();
    expect(e.open).toHaveBeenCalledWith({ type: 'nodes', key: null });
  });

  it('leave the hub where it is when the hub itself is the window in front', () => {
    const e = env({ id: 'nodes:', type: 'nodes', key: null, binding: 'primary' }, 'nodes:');
    e.run('nodes');
    expect(e.focus).toHaveBeenCalledWith('nodes:');
    expect(e.open).not.toHaveBeenCalled();
  });

  it('bring a hub that rides in ?w= to the front by opening it', () => {
    const e = env({ id: 'apps:', type: 'apps', key: null, binding: 'extra' });
    e.run('apps');
    expect(e.open).toHaveBeenCalledWith({ type: 'apps', key: null });
  });

  it('stand for the hub and the inspectors in the dock', () => {
    expect(LAUNCHERS.nodes.types).toEqual(['nodes', 'node', 'host']);
    expect(LAUNCHERS.apps.types).toEqual(['apps', 'app']);
  });
});

describe('the Operator launcher', () => {
  it('opens the watchlist, not the palette', () => {
    const e = env();
    e.run('operator');
    expect(e.open).toHaveBeenCalledWith({ type: 'operator', key: 'watchlist' });
    expect(e.palette).not.toHaveBeenCalled();
  });

  it('raises an operator window that is already open, whatever it shows', () => {
    const e = env({ id: 'operator:abc', type: 'operator', key: 'abc', binding: 'primary' });
    e.run('operator');
    expect(e.focus).toHaveBeenCalledWith('operator:abc');
    expect(e.open).not.toHaveBeenCalled();
  });

  it('brings an operator window that rides in ?w= to the front by opening it', () => {
    const e = env({ id: 'operator:abc', type: 'operator', key: 'abc', binding: 'extra' });
    e.run('operator');
    expect(e.open).toHaveBeenCalledWith({ type: 'operator', key: 'abc' });
  });
});

describe('the Explorer launcher', () => {
  it('opens the landing, not the latest block', () => {
    const e = env();
    e.run('explorer');
    expect(e.open).toHaveBeenCalledWith({ type: 'explorer', key: null });
    expect(e.palette).not.toHaveBeenCalled();
  });

  it('raises an explorer window that is open, whatever it shows', () => {
    const e = env({ id: 'block:2998000', type: 'block', key: '2998000', binding: 'primary' });
    e.run('explorer');
    expect(e.focus).toHaveBeenCalledWith('block:2998000');
    expect(e.open).not.toHaveBeenCalled();
  });

  it('goes home to the landing when the block in front is the only explorer window open', () => {
    const e = env(
      { id: 'block:2998000', type: 'block', key: '2998000', binding: 'primary' },
      'block:2998000',
    );
    e.run('explorer');
    expect(e.focus).not.toHaveBeenCalled();
    expect(e.open).toHaveBeenCalledWith({ type: 'explorer', key: null });
  });

  it('brings an explorer window that rides in ?w= to the front by opening it', () => {
    const e = env({ id: 'richlist:', type: 'richlist', key: null, binding: 'extra' });
    e.run('explorer');
    expect(e.open).toHaveBeenCalledWith({ type: 'richlist', key: null });
  });

  it('stands for the landing and every explorer view in the dock', () => {
    expect(LAUNCHERS.explorer.types).toEqual([
      'explorer',
      'block',
      'tx',
      'address',
      'mempool',
      'supply',
      'richlist',
    ]);
  });
});
