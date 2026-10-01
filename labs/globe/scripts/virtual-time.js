// A virtual clock for the page, injected before any page script runs (scripts/capture.mjs does it with
// `page.addInitScript`). It replaces everything a page can use to read or wait for time, so the film is a
// pure function of how many frames were stepped, never of how fast the machine ran:
//
//   performance.now, Date.now, new Date(), setTimeout, setInterval, requestAnimationFrame,
//   requestIdleCallback (and their cancel functions), and Math.random (a seeded stream).
//
// Time stands still until `__vt.advance(ms)` is called. `advance` moves the clock forward and, in the
// order a browser would: runs every timer that falls due (each at its own due time), then every queued
// animation-frame callback with the new time as its timestamp. Nothing else moves the clock.
//
// The wall clock (`Date.now`) is `__vt.wall0 + virtual ms`; the page sets `__vt.wall0` (see `setWall`) to
// the real UTC instant its film begins, so the sun, the moon's orbit and the chain of beads agree with it.
//
// CSS transitions and animations run on the compositor's own clock, which no script can virtualize. The
// film's overlay therefore never uses them: it writes its styles from the frame number.

(() => {
  if (window.__vt) return;
  const RealDate = Date;
  const realRaf = window.requestAnimationFrame.bind(window);
  let now = 1000; // ms; never 0, so `if (t)` tests in third-party code behave
  let wall0 = RealDate.now();
  let seq = 0;
  let nextId = 1;
  const timers = new Map();
  const frames = new Map();

  const perfNow = () => now;
  performance.now = perfNow;
  Date.now = () => wall0 + now;
  class VirtualDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(wall0 + now);
      else super(...args);
    }
    static now() {
      return wall0 + now;
    }
  }
  window.Date = VirtualDate;

  const addTimer = (fn, ms, args, interval) => {
    const id = nextId++;
    const delay = Math.max(0, Number(ms) || 0);
    timers.set(id, { id, fn, args, due: now + delay, seq: seq++, interval: interval ? Math.max(1, delay) : null });
    return id;
  };
  window.setTimeout = (fn, ms, ...args) => addTimer(typeof fn === 'function' ? fn : () => {}, ms, args, false);
  window.setInterval = (fn, ms, ...args) => addTimer(typeof fn === 'function' ? fn : () => {}, ms, args, true);
  window.clearTimeout = (id) => void timers.delete(id);
  window.clearInterval = (id) => void timers.delete(id);
  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => void frames.delete(id);
  window.requestIdleCallback = (cb) => addTimer(() => cb({ didTimeout: false, timeRemaining: () => 8 }), 1, [], false);
  window.cancelIdleCallback = (id) => void timers.delete(id);

  // mulberry32: the same sequence on every run.
  let rs = 0x9e3779b9;
  Math.random = () => {
    rs = (rs + 0x6d2b79f5) | 0;
    let t = Math.imul(rs ^ (rs >>> 15), 1 | rs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const fail = (e) => {
    console.error('[vt] callback threw', e && e.stack ? e.stack : e);
  };

  window.__vt = {
    /** Moves the clock forward by `ms`, running due timers and then the queued animation frames. */
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let next = null;
        for (const t of timers.values()) {
          if (t.due <= target && (next === null || t.due < next.due || (t.due === next.due && t.seq < next.seq))) next = t;
        }
        if (next === null) break;
        now = Math.max(now, next.due);
        if (next.interval !== null) {
          next.due = now + next.interval;
          next.seq = seq++;
        } else timers.delete(next.id);
        try {
          next.fn(...next.args);
        } catch (e) {
          fail(e);
        }
      }
      now = target;
      const queued = Array.from(frames.entries());
      frames.clear();
      for (const [, cb] of queued) {
        try {
          cb(now);
        } catch (e) {
          fail(e);
        }
      }
    },
    /** Virtual milliseconds since the page began. */
    now: () => now,
    /** Sets the real-world instant (epoch ms) that virtual time zero stands for. */
    setWall(epochMs) {
      wall0 = epochMs - now;
    },
    wall: () => wall0 + now,
    pendingTimers: () => timers.size,
    pendingFrames: () => frames.size,
    /** The browser's own animation-frame function, for waiting on the compositor between a draw and a capture. */
    realRaf,
  };
})();
