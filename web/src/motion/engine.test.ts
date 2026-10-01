// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUi } from '../store/ui';
import { attach, rules } from './attach';
import {
  current,
  installCount,
  installEngine,
  powerOff,
  powerOn,
  pulse,
  resetEngine,
  stats,
  useHost,
} from './engine';
import type { Anim, Animate, Fx } from './fxRunners';
import { MODE_ATTR, ROOT_ATTR } from './mode';

/** A controllable animation driver: nothing finishes until the test says so. */
function fakeDriver() {
  const anims: (Anim & {
    el: Element;
    keyframes: unknown;
    options: KeyframeAnimationOptions;
    cancelled: boolean;
    finish(): void;
  })[] = [];
  const animate: Animate = (el, keyframes, options) => {
    let done!: () => void;
    const finished = new Promise<void>((r) => {
      done = r;
    });
    const a = {
      el,
      keyframes,
      options,
      finished,
      cancelled: false,
      finish: () => done(),
      cancel() {
        a.cancelled = true;
      },
    };
    anims.push(a);
    return a;
  };
  return {
    animate,
    anims,
    finishAll: () => {
      for (const a of anims) a.finish();
    },
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function box(el: Element, x: number, y: number, w: number, h: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    x,
    y,
    left: x,
    top: y,
    right: x + w,
    bottom: y + h,
    width: w,
    height: h,
    toJSON: () => ({}),
  } as DOMRect);
}

function html(markup: string): HTMLElement {
  document.body.innerHTML = markup;
  return document.body.firstElementChild as HTMLElement;
}

function pointer(el: Element, type: string, x = 0, y = 0): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerType', { value: 'mouse' });
  el.dispatchEvent(e);
}

/** A clock the engine reads (performance.now), so "a moment later" is a number, not a wait. */
let clockNow = 1000;
const advance = (ms: number): void => {
  clockNow += ms;
};

function key(el: Element, k: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

const comets = () => document.querySelectorAll('.fx-comet').length;
const layer = () => document.querySelector('.fx-layer');

describe('engine', () => {
  let driver: ReturnType<typeof fakeDriver>;
  let fx: Fx;
  let release: () => void;

  beforeEach(async () => {
    clockNow = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clockNow);
    // jsdom does not implement getComputedStyle for pseudo-elements and says so on stderr every call.
    const style = globalThis.getComputedStyle.bind(globalThis);
    vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((el) => style(el));
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    useUi.setState({ motion: 'full' });
    document.documentElement.removeAttribute(ROOT_ATTR);
    document.documentElement.removeAttribute(MODE_ATTR);
    driver = fakeDriver();
    fx = await useHost((r) => new r.Fx({ animate: driver.animate }));
    release = installEngine();
  });

  afterEach(() => {
    release();
    resetEngine();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Pulse on data-pressed (the kit)', () => {
    it('draws light at the press point when a kit button gets data-pressed, and removes it all when it ends', async () => {
      const btn = html('<button class="ui-button" data-variant="secondary">Go</button>');
      box(btn, 100, 100, 120, 36);
      pointer(btn, 'pointerdown', 130, 118);
      btn.setAttribute('data-pressed', '');
      await tick();
      expect(layer()).not.toBeNull();
      expect(comets()).toBeGreaterThan(8); // two chains of links
      const seed = document.querySelector('.fx-seed') as HTMLElement;
      expect(seed).not.toBeNull();
      const kf = driver.anims.find((a) => a.el === seed)?.keyframes as { transform: string }[];
      expect(kf[0]?.transform).toContain('translate(30px, 18px)'); // the press, relative to the control
      expect(stats()?.active).toBe(1);

      driver.finishAll();
      await tick();
      expect(comets()).toBe(0);
      expect(document.querySelector('.fx-seed')).toBeNull();
      expect(stats()?.active).toBe(0);
      expect(btn.className).toBe('ui-button'); // the control itself was never touched
    });

    it('starts at the top centre for a key press (no pointer)', async () => {
      const btn = html('<button class="ui-button">Go</button>');
      box(btn, 100, 100, 120, 36);
      key(btn, 'Enter');
      btn.setAttribute('data-pressed', '');
      await tick();
      const seed = document.querySelector('.fx-seed') as HTMLElement;
      const kf = driver.anims.find((a) => a.el === seed)?.keyframes as { transform: string }[];
      expect(kf[0]?.transform).toContain('translate(60px, 0px)');
    });

    it('ignores a stale pointer press: only the press that just happened gives a point', async () => {
      const btn = html('<button class="ui-button">Go</button>');
      box(btn, 100, 100, 120, 36);
      pointer(btn, 'pointerdown', 130, 118);
      advance(1000);
      btn.setAttribute('data-pressed', '');
      await tick();
      const seed = document.querySelector('.fx-seed') as HTMLElement;
      const kf = driver.anims.find((a) => a.el === seed)?.keyframes as { transform: string }[];
      expect(kf[0]?.transform).toContain('translate(60px, 0px)');
    });

    it('does nothing for elements the rules do not name', async () => {
      const card = html('<div class="ui-card" data-pressed></div>');
      box(card, 0, 0, 200, 100);
      card.removeAttribute('data-pressed');
      card.setAttribute('data-pressed', '');
      await tick();
      expect(layer()).toBeNull();
      const tab = html('<button role="tab" class="ui-tabs__tab">A</button>');
      box(tab, 0, 0, 80, 36);
      tab.setAttribute('data-pressed', '');
      await tick();
      expect(comets()).toBe(0);
    });

    it('stays quiet in dense views, opt-outs, disabled and busy controls', async () => {
      const cases = [
        '<div data-fx-density="dense"><button class="ui-button">x</button></div>',
        '<div class="ui-table"><button class="ui-button">x</button></div>',
        '<div data-fx="off"><button class="ui-button">x</button></div>',
        '<button class="ui-button" disabled>x</button>',
        '<button class="ui-button" aria-disabled="true">x</button>',
        '<div inert><button class="ui-button">x</button></div>',
      ];
      for (const markup of cases) {
        const root = html(markup);
        const btn = root.matches('button') ? root : (root.querySelector('button') as HTMLElement);
        box(btn, 100, 100, 100, 36);
        btn.setAttribute('data-pressed', '');
        await tick();
        expect(comets(), markup).toBe(0);
      }
    });

    it('reports one change through one pulse, however many times the attribute is set', async () => {
      const btn = html('<button class="ui-button">Go</button>');
      box(btn, 100, 100, 100, 36);
      btn.setAttribute('data-pressed', '');
      await tick();
      const first = driver.anims.length;
      btn.removeAttribute('data-pressed');
      btn.setAttribute('data-pressed', ''); // within 100 ms: the same press
      await tick();
      expect(driver.anims.length).toBe(first);
    });

    it('colours the light white on a filled button', async () => {
      const btn = html('<button class="ui-button" data-variant="primary">Go</button>');
      box(btn, 100, 100, 120, 36);
      btn.setAttribute('data-pressed', '');
      await tick();
      expect(document.querySelector('.fx-box.fx-tone-hot')).not.toBeNull();
    });

    it('gives a button pressed together with others at most three pulses a second, and drops the rest', async () => {
      html(
        '<div><button class="ui-button">a</button><button class="ui-button">b</button><button class="ui-button">c</button><button class="ui-button">d</button></div>',
      );
      const buttons = [...document.querySelectorAll('button')];
      buttons.forEach((b, i) => {
        box(b, 10 + i * 130, 100, 120, 36);
        b.setAttribute('data-pressed', '');
      });
      await tick();
      expect(stats()?.byKind.pulse).toBe(3);
      expect(stats()?.dropped).toBeGreaterThanOrEqual(1);
    });
  });

  describe('motion modes', () => {
    it('draws nothing at all when motion is off', async () => {
      document.documentElement.setAttribute(ROOT_ATTR, 'off');
      const btn = html('<button class="ui-button">Go</button>');
      box(btn, 100, 100, 120, 36);
      btn.setAttribute('data-pressed', '');
      await tick();
      expect(layer()).toBeNull();
      expect(driver.anims).toHaveLength(0);
      expect(stats()?.granted).toBe(0);
    });

    it('draws only a short edge flash when motion is reduced', async () => {
      document.documentElement.setAttribute(ROOT_ATTR, 'reduced');
      const btn = html('<button class="ui-button">Go</button>');
      box(btn, 100, 100, 120, 36);
      btn.setAttribute('data-pressed', '');
      await tick();
      expect(document.querySelectorAll('.fx-edge-flash')).toHaveLength(1);
      expect(comets()).toBe(0);
      expect(driver.anims[0]?.options.duration).toBeLessThanOrEqual(200);
    });

    it('follows a subtree override over the page', async () => {
      document.documentElement.setAttribute(ROOT_ATTR, 'full');
      const root = html(`<section ${MODE_ATTR}="off"><button class="ui-button">Go</button></section>`);
      const btn = root.querySelector('button') as HTMLElement;
      box(btn, 100, 100, 120, 36);
      btn.setAttribute('data-pressed', '');
      await tick();
      expect(layer()).toBeNull();
    });
  });

  describe('Spark on data-state', () => {
    const SWITCH =
      '<label class="ui-switch" data-state="off"><input type="checkbox" role="switch"><span class="ui-switch__track"><span class="ui-switch__knob"></span></span></label>';

    it('lands on the knob when a switch the person flipped turns on', async () => {
      const sw = html(SWITCH);
      box(sw, 50, 50, 200, 32);
      const track = sw.querySelector('.ui-switch__track') as HTMLElement;
      box(track, 50, 56, 36, 20);
      pointer(sw.querySelector('input') as HTMLElement, 'pointerdown', 60, 66);
      sw.setAttribute('data-state', 'on');
      await tick();
      const host = document.querySelector('.fx-spark') as HTMLElement;
      expect(host).not.toBeNull();
      expect(host.style.transform).toBe('translate(76px, 66px)'); // the end of the track: right - height / 2
      expect(stats()?.byKind.spark).toBe(1);
    });

    it('does not spark for a change the app made on its own', async () => {
      const sw = html(SWITCH);
      box(sw, 50, 50, 200, 32);
      sw.setAttribute('data-state', 'on'); // no input before it
      await tick();
      expect(layer()).toBeNull();
    });

    it('does not spark when turning off, or for a state that stayed on', async () => {
      const sw = html(SWITCH.replace('"off"', '"on"'));
      box(sw, 50, 50, 200, 32);
      pointer(sw, 'pointerdown', 60, 66);
      sw.setAttribute('data-state', 'off');
      await tick();
      expect(layer()).toBeNull();
      pointer(sw, 'pointerdown', 60, 66);
      sw.setAttribute('data-state', 'off');
      sw.setAttribute('data-state', 'idle');
      await tick();
      expect(layer()).toBeNull();
    });

    it('sparks a toggle chip once even though it reports the change twice', async () => {
      const chip = html(
        '<button class="ui-chip" data-state="off" aria-pressed="false"><svg></svg>Watch</button>',
      );
      box(chip, 10, 10, 90, 22);
      const icon = chip.querySelector('svg') as Element;
      box(icon, 16, 14, 14, 14);
      pointer(chip, 'pointerdown', 20, 20);
      chip.setAttribute('aria-pressed', 'true');
      chip.setAttribute('data-state', 'on');
      await tick();
      expect(document.querySelectorAll('.fx-spark')).toHaveLength(1);
      expect((document.querySelector('.fx-spark') as HTMLElement).style.transform).toBe(
        'translate(23px, 21px)',
      );
    });

    it('answers a toggle chip with a Spark and no Pulse: one effect per interaction', async () => {
      const chip = html(
        '<button class="ui-chip" data-state="off" aria-pressed="false"><svg></svg>Watch</button>',
      );
      box(chip, 10, 10, 90, 22);
      box(chip.querySelector('svg') as Element, 16, 14, 14, 14);
      pointer(chip, 'pointerdown', 20, 20);
      chip.setAttribute('data-pressed', '');
      await tick();
      expect(layer()).toBeNull(); // the press alone draws nothing: the chip is a toggle
      chip.setAttribute('data-state', 'on');
      await tick();
      expect(document.querySelectorAll('.fx-spark')).toHaveLength(1);
      expect(comets()).toBe(0);
      expect(stats()?.byKind.pulse).toBe(0);
    });

    it('sparks on the icon when a copy button reports copied, in a dense table too', async () => {
      const root = html(
        '<div class="ui-table"><button class="ui-copy" data-state="idle"><svg></svg></button></div>',
      );
      const btn = root.querySelector('button') as HTMLElement;
      box(btn, 40, 40, 20, 20);
      box(btn.querySelector('svg') as Element, 43, 43, 14, 14);
      pointer(btn, 'pointerdown', 50, 50);
      btn.setAttribute('data-state', 'copied');
      await tick();
      expect(document.querySelectorAll('.fx-spark')).toHaveLength(1);
    });

    it('sparks any element that says data-fx="toggle" when aria-checked turns true', async () => {
      const el = html('<div data-fx="toggle" aria-checked="false">x</div>');
      box(el, 10, 10, 60, 24);
      pointer(el, 'pointerdown', 20, 20);
      el.setAttribute('aria-checked', 'true');
      await tick();
      expect(document.querySelectorAll('.fx-spark')).toHaveLength(1);
    });
  });

  describe('Current on data-fresh', () => {
    it('runs one streak along the top of a row that opted in when it gets data-fresh', async () => {
      const row = html('<div data-fx="current">row</div>');
      box(row, 20, 20, 400, 40);
      row.setAttribute('data-fresh', '');
      await tick();
      expect(comets()).toBe(1);
      expect(stats()?.byKind.current).toBe(1);
      driver.finishAll();
      await tick();
      expect(comets()).toBe(0);
    });

    it('draws the streak inside a positioned row, so the light goes where the row goes, and takes it away', async () => {
      const row = html('<div data-fx="current" data-fx-edge="bottom" style="position: relative">row</div>');
      box(row, 20, 20, 400, 40);
      row.setAttribute('data-fresh', '');
      await tick();
      const track = row.querySelector('.fx-current');
      expect(track).not.toBeNull();
      expect(track?.getAttribute('data-edge')).toBe('bottom');
      expect(track?.getAttribute('aria-hidden')).toBe('true');
      expect(track?.querySelectorAll('.fx-comet')).toHaveLength(1);
      expect(layer()).toBeNull(); // no overlay: nothing is positioned over the rectangle
      driver.finishAll();
      await tick();
      expect(row.querySelector('.fx-current')).toBeNull();
      expect(row.textContent).toBe('row');
    });

    it('does not run for a row that was created with data-fresh already on it', async () => {
      // The contract the views keep through useFresh: the attribute has to APPEAR on an element that exists.
      const row = html('<div data-fx="current" data-fresh style="position: relative">row</div>');
      box(row, 20, 20, 400, 40);
      await tick();
      expect(comets()).toBe(0);
      expect(row.querySelector('.fx-current')).toBeNull();
    });

    describe('data-fx-delay: a row that follows an arrival with its own light', () => {
      const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      it('asks for the light only when the delay is over, and takes no budget while it waits', async () => {
        const row = html('<div data-fx="current" data-fx-delay="40" style="position: relative">row</div>');
        box(row, 20, 20, 400, 40);
        row.setAttribute('data-fresh', '');
        await tick();
        expect(comets()).toBe(0);
        expect(stats()?.active).toBe(0);
        await wait(70);
        expect(comets()).toBe(1);
        expect(stats()?.byKind.current).toBe(1);
      });

      it('gets its light after two Currents that would have used the whole budget, once they are gone', async () => {
        document.body.innerHTML = `
          <div id="a" data-fx="current" style="position: relative">a</div>
          <div id="b" data-fx="current" style="position: relative">b</div>
          <div id="c" data-fx="current" data-fx-delay="40" style="position: relative">c</div>`;
        const byId = (id: string) => document.getElementById(id) as HTMLElement;
        const c = byId('c');
        for (const el of [byId('a'), byId('b'), c]) {
          box(el, 20, 20, 400, 40);
          el.setAttribute('data-fresh', '');
        }
        await tick();
        expect(stats()?.byKind.current).toBe(2); // a and b; c is still waiting
        expect(stats()?.dropped).toBe(0); // and nothing was refused
        driver.finishAll();
        await wait(70);
        expect(c.querySelectorAll('.fx-comet')).toHaveLength(1);
        expect(stats()?.dropped).toBe(0);
      });

      it('starts no timer at all when motion is off', async () => {
        useUi.setState({ motion: 'off' });
        const timers = vi.spyOn(globalThis, 'setTimeout');
        const row = html('<div data-fx="current" data-fx-delay="40" style="position: relative">row</div>');
        box(row, 20, 20, 400, 40);
        timers.mockClear();
        row.setAttribute('data-fresh', '');
        await Promise.resolve();
        await Promise.resolve();
        expect(timers.mock.calls.filter(([, ms]) => ms === 40)).toHaveLength(0);
        timers.mockRestore();
      });

      it('draws nothing when the row went away, or stopped being fresh, while it waited', async () => {
        document.body.innerHTML = `
          <div id="gone" data-fx="current" data-fx-delay="30" style="position: relative">a</div>
          <div id="stale" data-fx="current" data-fx-delay="30" style="position: relative">b</div>`;
        const gone = document.getElementById('gone') as HTMLElement;
        const stale = document.getElementById('stale') as HTMLElement;
        box(gone, 20, 20, 400, 40);
        box(stale, 20, 80, 400, 40);
        gone.setAttribute('data-fresh', '');
        stale.setAttribute('data-fresh', '');
        await tick();
        gone.remove();
        stale.removeAttribute('data-fresh');
        await wait(60);
        expect(comets()).toBe(0);
        expect(stats()?.active).toBe(0);
      });
    });

    it('leaves rows that did not opt in to the kit', async () => {
      const row = html('<div class="ui-table__row">row</div>');
      box(row, 20, 20, 400, 40);
      row.setAttribute('data-fresh', '');
      await tick();
      expect(layer()).toBeNull();
    });
  });

  describe('elements outside the kit (data-fx tokens)', () => {
    it('pulses on pointer press and on Enter or Space, not on text entry or a link space', async () => {
      const el = html(
        '<div data-fx="press"><button id="b">x</button><a id="l" href="#">l</a><input id="i"></div>',
      );
      box(el, 10, 10, 120, 40);
      pointer(el, 'pointerdown', 40, 30);
      await tick();
      expect(comets()).toBeGreaterThan(0);
      driver.finishAll();
      await tick();
      expect(comets()).toBe(0);
      advance(500);
      key(el, ' ');
      await tick();
      expect(comets()).toBeGreaterThan(0);
      driver.finishAll();
      await tick();
      key(el.querySelector('#i') as Element, 'Enter'); // text entry never pulses
      await tick();
      expect(comets()).toBe(0);
    });

    it('answers a rule added at runtime and forgets it when removed', async () => {
      const detach = attach('press', '.launcher');
      expect(rules.press).toContain('.launcher');
      const el = html('<button class="launcher">go</button>');
      box(el, 10, 10, 100, 36);
      el.setAttribute('data-pressed', '');
      await tick();
      expect(comets()).toBeGreaterThan(0);
      driver.finishAll();
      await tick();
      detach();
      expect(rules.press).not.toContain('.launcher');
      el.removeAttribute('data-pressed');
      advance(500);
      el.setAttribute('data-pressed', '');
      await tick();
      expect(comets()).toBe(0);
    });
  });

  describe('Charge: the light follows the pointer over a button', () => {
    it('hands the pointer position to the CSS while it moves, and lets go on leave', async () => {
      const btn = html('<button class="ui-button">Go</button>');
      box(btn, 100, 100, 200, 36);
      pointer(btn, 'pointerover', 150, 110);
      expect(btn.style.getPropertyValue('--fx-reach')).toBe('120px'); // 70% of the long side, capped
      expect(btn.style.getPropertyValue('--fx-x')).toBe('50.0px');
      expect(btn.style.getPropertyValue('--fx-y')).toBe('10.0px');
      pointer(btn, 'pointermove', 250, 120);
      await new Promise((r) => requestAnimationFrame(r));
      expect(btn.style.getPropertyValue('--fx-x')).toBe('150.0px');
      pointer(btn, 'pointerout', 0, 0);
      pointer(btn, 'pointermove', 120, 120);
      await new Promise((r) => requestAnimationFrame(r));
      expect(btn.style.getPropertyValue('--fx-x')).toBe('150.0px'); // no longer tracking
    });

    it('does not track in reduced or off, or on a disabled control', () => {
      document.documentElement.setAttribute(ROOT_ATTR, 'reduced');
      const btn = html('<button class="ui-button">Go</button>');
      box(btn, 100, 100, 200, 36);
      pointer(btn, 'pointerover', 150, 110);
      expect(btn.style.getPropertyValue('--fx-x')).toBe('');
      document.documentElement.setAttribute(ROOT_ATTR, 'full');
      const dis = html('<button class="ui-button" disabled>Go</button>');
      box(dis, 100, 100, 200, 36);
      pointer(dis, 'pointerover', 150, 110);
      expect(dis.style.getPropertyValue('--fx-x')).toBe('');
    });
  });

  describe('imperative API and lifecycle', () => {
    it('pulse() draws on any element and returns a handle that cancels', async () => {
      const el = html('<div>x</div>');
      box(el, 10, 10, 100, 40);
      const h = pulse(el);
      expect(h).not.toBeNull();
      expect(comets()).toBeGreaterThan(0);
      h?.cancel();
      expect(comets()).toBe(0);
      expect(stats()?.active).toBe(0);
    });

    it('powerOn then powerOff animate the element, and off resolves at once when effects are off', async () => {
      const el = html('<div>window</div>');
      box(el, 10, 10, 300, 200);
      const on = powerOn(el, { origin: { x: 5, y: 5 } });
      expect(on).not.toBeNull();
      expect(driver.anims.length).toBeGreaterThan(0);
      on?.cancel();
      document.documentElement.setAttribute(ROOT_ATTR, 'off');
      expect(powerOn(el)).toBeNull();
      await expect(powerOff(el).done).resolves.toBeUndefined();
    });

    it('opens the aperture 64 px past the farthest corner, so a drop shadow is never cut off at the end', () => {
      const el = html('<div>window</div>');
      box(el, 10, 10, 300, 200);
      powerOn(el, { origin: { x: 5, y: 5 }, aperture: true });
      const reveal = driver.anims.find(
        (a) => a.el === el && (a.keyframes as { clipPath?: string }[])[0]?.clipPath !== undefined,
      );
      const keys = reveal?.keyframes as { clipPath: string }[];
      expect(keys[0]?.clipPath).toBe('circle(0px at -5px -5px)');
      // the farthest corner is 368 px away (hypot(305, 205) rounded up), plus 4 px, plus the bleed
      expect(keys[1]?.clipPath).toBe('circle(436px at -5px -5px)');
    });

    it('starts a Current after its delay, for a card that lands a beat after it mounts', () => {
      const el = html('<div style="position: relative">card</div>');
      box(el, 10, 10, 200, 80);
      const h = current(el, { edge: 'perimeter', delay: 90 });
      expect(h).not.toBeNull();
      const mine = driver.anims.filter((a) => el.contains(a.el) || a.el.closest('.fx-layer'));
      expect(mine.length).toBeGreaterThan(0);
      for (const a of mine) expect(a.options.delay).toBe(90);
      h?.cancel();
      driver.anims.length = 0;
      current(el, { edge: 'top' });
      for (const a of driver.anims) expect(a.options.delay ?? 0).toBe(0);
    });

    it('holds a far origin to 48 px outside the window, so the first frame already shows it', () => {
      const el = html('<div>window</div>');
      box(el, 10, 10, 300, 200);
      // a dock icon a thousand pixels to the lower right: the circle starts at the window's nearest corner zone
      powerOn(el, { origin: { x: 1100, y: 1000 }, aperture: true });
      const reveal = driver.anims.find(
        (a) => a.el === el && (a.keyframes as { clipPath?: string }[])[0]?.clipPath !== undefined,
      );
      const keys = reveal?.keyframes as { clipPath: string }[];
      expect(keys[0]?.clipPath).toBe('circle(0px at 348px 248px)');
      const scale = driver.anims.find((a) => a.el === el && (a.keyframes as object[]).length === 3);
      const entrance = (scale?.keyframes ?? []) as { transformOrigin: string }[];
      expect(entrance[0]?.transformOrigin).toBe('348px 248px');
    });

    it('takes an origin as a point on the element itself (a toast grows out of its right edge)', () => {
      const el = html('<div>toast</div>');
      box(el, 10, 10, 300, 200);
      powerOn(el, { origin: { fx: 1, fy: 0.5 }, variant: 'panel' });
      const scale = driver.anims.find((a) => a.el === el && (a.keyframes as object[]).length === 3);
      const entrance = (scale?.keyframes ?? []) as { transformOrigin: string }[];
      expect(entrance[0]?.transformOrigin).toBe('300px 100px');
    });

    it('stops listening when the last installer lets go (StrictMode double install is one install)', async () => {
      const second = installEngine();
      expect(installCount()).toBe(2);
      second();
      second();
      expect(installCount()).toBe(1);
      release();
      expect(installCount()).toBe(0);
      const btn = html('<button class="ui-button">Go</button>');
      box(btn, 100, 100, 120, 36);
      btn.setAttribute('data-pressed', '');
      await tick();
      expect(layer()).toBeNull();
      release = installEngine(); // afterEach releases it
    });

    it('ends every running effect when the host is disposed', async () => {
      const btn = html('<button class="ui-button">Go</button>');
      box(btn, 100, 100, 120, 36);
      btn.setAttribute('data-pressed', '');
      await tick();
      expect(comets()).toBeGreaterThan(0);
      fx.dispose();
      expect(comets()).toBe(0);
      expect(layer()).toBeNull();
    });
  });
});
