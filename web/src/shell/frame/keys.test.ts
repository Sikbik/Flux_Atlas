import { describe, expect, it } from 'vitest';
import { launcherForKey } from './keys';

describe('launcherForKey', () => {
  it('maps the launcher letters, case-insensitively without shift', () => {
    expect(launcherForKey('g', false)).toBe('globe');
    expect(launcherForKey('G', false)).toBe('globe');
    expect(launcherForKey('n', false)).toBe('nodes');
    expect(launcherForKey('a', false)).toBe('apps');
    expect(launcherForKey('e', false)).toBe('explorer');
    expect(launcherForKey('q', false)).toBe('queue');
    expect(launcherForKey('s', false)).toBe('analytics');
    expect(launcherForKey('t', false)).toBe('time');
    expect(launcherForKey('o', false)).toBe('operator');
    expect(launcherForKey('w', false)).toBe('weather');
    expect(launcherForKey('m', false)).toBe('about');
  });

  it('maps the backtick to the terminal', () => {
    expect(launcherForKey('`', false)).toBe('terminal');
  });

  it('keeps Shift and A for ambient mode, and only that', () => {
    expect(launcherForKey('A', true)).toBe('ambient');
    expect(launcherForKey('W', true)).toBeNull();
    expect(launcherForKey('N', true)).toBeNull();
  });

  it('ignores keys that are not launchers', () => {
    expect(launcherForKey('x', false)).toBeNull();
    expect(launcherForKey('Enter', false)).toBeNull();
    expect(launcherForKey('1', false)).toBeNull();
  });
});
