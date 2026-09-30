// Fixed-capacity ring buffer with a version counter. `toArray()` returns newest first and is cached
// per version, so React selectors get a stable reference until the ring changes.

export class Ring<T> {
  readonly capacity: number;
  private buf: (T | undefined)[];
  private head = 0; // index of the next write
  private len = 0;
  private cache: T[] | null = null;
  version = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
    this.buf = new Array(this.capacity);
  }

  get size(): number {
    return this.len;
  }

  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.len < this.capacity) this.len++;
    this.cache = null;
    this.version++;
  }

  /** Newest item, or undefined when empty. */
  newest(): T | undefined {
    if (this.len === 0) return undefined;
    return this.buf[(this.head - 1 + this.capacity) % this.capacity];
  }

  /** Item `i` counted from the newest (0 = newest). */
  at(i: number): T | undefined {
    if (i < 0 || i >= this.len) return undefined;
    return this.buf[(this.head - 1 - i + this.capacity * 2) % this.capacity];
  }

  /** Newest first; the same array instance until the next change. */
  toArray(): readonly T[] {
    if (this.cache) return this.cache;
    const out = new Array<T>(this.len);
    for (let i = 0; i < this.len; i++) out[i] = this.at(i) as T;
    this.cache = out;
    return out;
  }

  /** Replaces the contents with `items` given oldest first. */
  reset(itemsOldestFirst: readonly T[]): void {
    this.buf = new Array(this.capacity);
    this.head = 0;
    this.len = 0;
    const start = Math.max(0, itemsOldestFirst.length - this.capacity);
    for (let i = start; i < itemsOldestFirst.length; i++) {
      this.buf[this.head] = itemsOldestFirst[i];
      this.head = (this.head + 1) % this.capacity;
      this.len++;
    }
    this.cache = null;
    this.version++;
  }

  /** Replaces the newest item matching `pred` (used to merge a live block into its bootstrap row). */
  replaceWhere(pred: (item: T) => boolean, next: T): boolean {
    for (let i = 0; i < this.len; i++) {
      const idx = (this.head - 1 - i + this.capacity * 2) % this.capacity;
      const item = this.buf[idx];
      if (item !== undefined && pred(item)) {
        this.buf[idx] = next;
        this.cache = null;
        this.version++;
        return true;
      }
    }
    return false;
  }
}
