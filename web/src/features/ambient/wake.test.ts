// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { installWake, keyWakes, PointerTravel, type WakeKind } from './wake';

const key = (key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}) => ({
  key,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
});

describe('keyWakes', () => {
  it('wakes on an ordinary key, Escape and Space included', () => {
    expect(keyWakes(key('a'))).toBe(true);
    expect(keyWakes(key('Escape'))).toBe(true);
    expect(keyWakes(key(' '))).toBe(true);
    expect(keyWakes(key('ArrowDown'))).toBe(true);
    expect(keyWakes(key('A'))).toBe(true);
  });

  it('leaves bare modifiers, function keys and media keys alone', () => {
    for (const k of [
      'Shift',
      'Control',
      'Alt',
      'Meta',
      'CapsLock',
      'F5',
      'F11',
      'AudioVolumeUp',
      'MediaPlayPause',
    ])
      expect(keyWakes(key(k))).toBe(false);
  });

  it('leaves browser chords alone', () => {
    expect(keyWakes(key('r', { ctrl: true }))).toBe(false);
    expect(keyWakes(key('w', { meta: true }))).toBe(false);
    expect(keyWakes(key('Tab', { alt: true }))).toBe(false);
  });
});

describe('PointerTravel', () => {
  it('wakes once the pointer has gone 8 px in one movement', () => {
    const p = new PointerTravel();
    expect(p.move(100, 100, 0)).toBe(false);
    expect(p.move(103, 100, 16)).toBe(false);
    expect(p.move(106, 100, 32)).toBe(false);
    expect(p.move(109, 100, 48)).toBe(true);
  });

  it('starts counting again after a pause, so a jittering sensor never wakes it', () => {
    const p = new PointerTravel();
    let woke = false;
    for (let i = 0; i < 40; i++) woke = p.move(100 + (i % 2), 100, i * 1000) || woke;
    expect(woke).toBe(false);
  });
});

describe('installWake', () => {
  const setup = (graceMs = 900) => {
    let t = 1000;
    const woke: WakeKind[] = [];
    const stop = installWake({ onWake: (k) => woke.push(k), graceMs, now: () => t });
    return { woke, stop, advance: (ms: number) => (t += ms) };
  };

  const send = (type: string, init: EventInit & Record<string, unknown> = {}) => {
    const e = new Event(type, { bubbles: true, cancelable: true, ...init });
    for (const [k, v] of Object.entries(init)) Object.defineProperty(e, k, { value: v });
    let reached = false;
    const probe = () => {
      reached = true;
    };
    document.body.addEventListener(type, probe);
    window.dispatchEvent(e);
    document.body.dispatchEvent(e);
    document.body.removeEventListener(type, probe);
    return { reached, prevented: e.defaultPrevented };
  };

  it('ignores input during the grace period but still swallows it', () => {
    const { woke, stop } = setup();
    const r = send('pointerdown', { clientX: 5, clientY: 5 });
    expect(woke).toEqual([]);
    expect(r.reached).toBe(false);
    stop();
  });

  it('wakes on a press, a key or a wheel turn once the grace has passed', () => {
    for (const [type, init, kind] of [
      ['pointerdown', { clientX: 1, clientY: 1 }, 'press'],
      ['keydown', { key: 'x', ctrlKey: false, metaKey: false, altKey: false }, 'key'],
      ['wheel', {}, 'wheel'],
    ] as const) {
      const { woke, stop, advance } = setup();
      advance(1000);
      send(type, init);
      expect(woke).toEqual([kind]);
      stop();
    }
  });

  it('wakes once, whatever else follows', () => {
    const { woke, stop, advance } = setup();
    advance(1000);
    send('pointerdown', { clientX: 1, clientY: 1 });
    send('keydown', { key: 'x', ctrlKey: false, metaKey: false, altKey: false });
    expect(woke).toEqual(['press']);
    stop();
  });

  it('lets a browser chord through untouched', () => {
    const { woke, stop, advance } = setup();
    advance(1000);
    const r = send('keydown', { key: 'r', ctrlKey: true, metaKey: false, altKey: false });
    expect(woke).toEqual([]);
    expect(r.reached).toBe(true);
    expect(r.prevented).toBe(false);
    stop();
  });

  it('stops listening when stopped', () => {
    const { woke, stop, advance } = setup();
    advance(1000);
    stop();
    const r = send('pointerdown', { clientX: 1, clientY: 1 });
    expect(woke).toEqual([]);
    expect(r.reached).toBe(true);
  });
});
