// The effect budget: how many animated effects may exist at once, and who yields to whom.
//
// Every effect runner asks for a lease before it creates a single DOM node. No lease, no visuals:
// the control's static state (ink step, selected style, the value itself) is already correct, so a
// refused effect costs the user nothing. Rules, in the order they are applied:
//
//   1. Rate: pulse and spark are the "flash" class. At most `flashMax` of them start per
//      `flashWindowMs` (3 per second, the WCAG 2.3.1 ceiling), whatever element they land on.
//   2. Replace, never stack: a new effect on an element that already has one cancels the old one.
//   3. Per-kind cap: pulse 3, spark 3, slide 3, current 2, settle 8, power 2 at once.
//   4. Total cap (10). A user-class effect (power, pulse, spark, slide) that finds the room full
//      preempts the oldest live-class effect (current, settle); live effects never preempt anything
//      and are simply dropped.
//
// Live-class effects (a block arrived, a value changed) therefore yield to the user's own input,
// and a burst of network events can never starve or stack on top of what the user is doing.

export type FxKind = 'pulse' | 'spark' | 'slide' | 'power' | 'current' | 'settle';
export type FxClass = 'user' | 'live';

export const FX_CLASS: Readonly<Record<FxKind, FxClass>> = {
  pulse: 'user',
  spark: 'user',
  slide: 'user',
  power: 'user',
  current: 'live',
  settle: 'live',
};

const FLASH: ReadonlySet<FxKind> = new Set<FxKind>(['pulse', 'spark']);

export interface BudgetOptions {
  /** Effects alive at once, all kinds together. */
  total?: number;
  /** Per-kind concurrency caps. */
  caps?: Partial<Record<FxKind, number>>;
  /** Pulse and spark starts allowed per `flashWindowMs`. */
  flashMax?: number;
  flashWindowMs?: number;
  /** Clock, injectable for tests. */
  now?: () => number;
}

export const DEFAULT_BUDGET: Required<Omit<BudgetOptions, 'now'>> = {
  total: 10,
  caps: { power: 2, pulse: 3, spark: 3, slide: 3, current: 2, settle: 8 },
  flashMax: 3,
  flashWindowMs: 1000,
};

export interface Lease {
  readonly id: number;
  readonly kind: FxKind;
  /** True until released or preempted. */
  readonly live: boolean;
  /** Frees the slot. Idempotent. */
  release(): void;
}

interface Entry {
  id: number;
  kind: FxKind;
  key: unknown;
  at: number;
  onPreempt: (() => void) | undefined;
  lease: Lease;
  alive: boolean;
}

export interface BudgetStats {
  active: number;
  byKind: Record<FxKind, number>;
  granted: number;
  dropped: number;
  preempted: number;
}

export class Budget {
  readonly #total: number;
  readonly #caps: Record<FxKind, number>;
  readonly #flashMax: number;
  readonly #flashWindow: number;
  readonly #now: () => number;
  readonly #entries = new Map<number, Entry>();
  readonly #byKey = new Map<unknown, number>();
  #flashes: number[] = [];
  #seq = 0;
  #granted = 0;
  #dropped = 0;
  #preempted = 0;

  constructor(opts: BudgetOptions = {}) {
    this.#total = opts.total ?? DEFAULT_BUDGET.total;
    this.#caps = { ...DEFAULT_BUDGET.caps, ...opts.caps } as Record<FxKind, number>;
    this.#flashMax = opts.flashMax ?? DEFAULT_BUDGET.flashMax;
    this.#flashWindow = opts.flashWindowMs ?? DEFAULT_BUDGET.flashWindowMs;
    this.#now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  }

  /**
   * Asks for a slot. Returns a lease, or null when the budget says no (the caller draws nothing).
   * `key` identifies the target (usually the element): a second effect on the same key replaces the
   * first. `onPreempt` runs when the lease is taken away (replaced or preempted); the holder must
   * then stop and clean up.
   */
  acquire(kind: FxKind, key: unknown = null, onPreempt?: () => void): Lease | null {
    const t = this.#now();
    if (FLASH.has(kind)) {
      this.#flashes = this.#flashes.filter((x) => t - x < this.#flashWindow);
      if (this.#flashes.length >= this.#flashMax) return this.#drop();
    }

    // Replace, never stack. The old effect stops before the new one is counted.
    if (key !== null && key !== undefined) {
      const prev = this.#byKey.get(key);
      if (prev !== undefined) this.#revoke(prev, true);
    }

    if (this.#count(kind) >= this.#caps[kind]) return this.#drop();

    if (this.#entries.size >= this.#total) {
      if (FX_CLASS[kind] === 'live') return this.#drop();
      const victim = this.#oldestLive();
      if (victim === undefined) return this.#drop();
      this.#revoke(victim, true);
    }

    const id = ++this.#seq;
    const entry: Entry = {
      id,
      kind,
      key,
      at: t,
      onPreempt,
      alive: true,
      lease: {
        id,
        kind,
        get live() {
          return entry.alive;
        },
        release: () => this.#revoke(id, false),
      },
    };
    this.#entries.set(id, entry);
    if (key !== null && key !== undefined) this.#byKey.set(key, id);
    if (FLASH.has(kind)) this.#flashes.push(t);
    this.#granted++;
    return entry.lease;
  }

  stats(): BudgetStats {
    const byKind = { pulse: 0, spark: 0, slide: 0, power: 0, current: 0, settle: 0 } as Record<
      FxKind,
      number
    >;
    for (const e of this.#entries.values()) byKind[e.kind]++;
    return {
      active: this.#entries.size,
      byKind,
      granted: this.#granted,
      dropped: this.#dropped,
      preempted: this.#preempted,
    };
  }

  /** Revokes every lease (each holder's `onPreempt` runs) and forgets the flash history. */
  dispose(): void {
    for (const id of [...this.#entries.keys()]) this.#revoke(id, true);
    this.#flashes = [];
  }

  #drop(): null {
    this.#dropped++;
    return null;
  }

  #count(kind: FxKind): number {
    let n = 0;
    for (const e of this.#entries.values()) if (e.kind === kind) n++;
    return n;
  }

  #oldestLive(): number | undefined {
    let best: Entry | undefined;
    for (const e of this.#entries.values()) {
      if (FX_CLASS[e.kind] !== 'live') continue;
      if (!best || e.at < best.at) best = e;
    }
    return best?.id;
  }

  #revoke(id: number, preempt: boolean): void {
    const e = this.#entries.get(id);
    if (!e?.alive) return;
    e.alive = false;
    this.#entries.delete(id);
    if (e.key !== null && e.key !== undefined && this.#byKey.get(e.key) === id) this.#byKey.delete(e.key);
    if (preempt) {
      this.#preempted++;
      e.onPreempt?.();
    }
  }
}
