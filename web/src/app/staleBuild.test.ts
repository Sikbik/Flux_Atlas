import { describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadForUpdate, STALE_RELOAD_WINDOW_MS } from './staleBuild';

function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe('stale build recovery', () => {
  it('knows the chunk load failures of each engine', () => {
    expect(
      isChunkLoadError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://atlas.app.runonflux.io/assets/Toasts-D4y7T97M.js',
        ),
      ),
    ).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: /assets/x.js'))).toBe(
      true,
    );
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/x.css'))).toBe(true);
    expect(isChunkLoadError(new Error('The server returned an error'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  it('reloads once, then lets a repeat failure inside the window show', () => {
    const store = memory();
    const reload = vi.fn();
    expect(reloadForUpdate(1_000_000, store, reload)).toBe(true);
    expect(reloadForUpdate(1_000_000 + STALE_RELOAD_WINDOW_MS - 1, store, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadForUpdate(1_000_000 + STALE_RELOAD_WINDOW_MS, store, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('never reloads when the guard cannot be kept', () => {
    const reload = vi.fn();
    expect(reloadForUpdate(1, null, reload)).toBe(false);
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(reloadForUpdate(1, broken, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
