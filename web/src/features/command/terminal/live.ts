// What outlives the terminal's React instance: the command that is running, the line being typed and a
// request to take the keyboard back. The terminal window remounts when a command moves it between the
// route's primary window and `?w=` (opening a node beside it, say), and a `tail` must keep going through
// that. It stops only when the window is really gone: no new instance appears within a moment.

export interface Running {
  name: string;
  streaming: boolean;
}

/** How long a window may be gone before its running stream is stopped. */
export const DETACH_GRACE_MS = 2_000;
/** How long after a command opened something the prompt keeps asking for the keyboard. */
const FOCUS_WINDOW_MS = 1_500;

let running: Running | null = null;
let aborter: AbortController | null = null;
let draft = '';
let focusUntil = 0;
let detachTimer: number | null = null;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const l of [...listeners]) l();
};

export const live = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  running(): Running | null {
    return running;
  },

  /** Marks a command as running and returns the controller its stream listens to. */
  start(r: Running): AbortController {
    aborter = new AbortController();
    running = r;
    emit();
    return aborter;
  },

  stop(): void {
    running = null;
    aborter = null;
    emit();
  },

  /** Ctrl+C or Stop: true when something was running. */
  interrupt(): boolean {
    if (!aborter) return false;
    aborter.abort();
    return true;
  },

  /** A terminal instance is on screen: a pending stop is cancelled. */
  attach(): void {
    if (detachTimer !== null) window.clearTimeout(detachTimer);
    detachTimer = null;
  },

  /** The instance is gone. If none comes back soon, the running command is stopped. */
  detach(): void {
    if (detachTimer !== null) window.clearTimeout(detachTimer);
    detachTimer = window.setTimeout(() => {
      detachTimer = null;
      aborter?.abort();
    }, DETACH_GRACE_MS);
  },

  getDraft: (): string => draft,
  setDraft(v: string): void {
    draft = v;
  },

  /** A command opened something: whichever instance exists next should take the keyboard back. */
  wantFocus(): void {
    focusUntil = Date.now() + FOCUS_WINDOW_MS;
  },
  focusWanted: (): boolean => Date.now() < focusUntil,
};
