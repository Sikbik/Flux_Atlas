// Payout and expiry countdowns as a big number plus a small unit, so the number can tick on its own
// (`14.7` `h`, `28` `s`). Copy rules from the design (4.3): "Next block" at position 0, seconds under
// 90 s, minutes under an hour, hours above ("in 14.7 h"), days beyond two.

export interface EtaParts {
  /** The figure: `28`, `12`, `14.7`, `2d 3h`. */
  value: string;
  /** The unit: `s`, `min`, `h`, or empty when the figure carries it. */
  unit: string;
  /** Natural-language form for text and assistive technology: `in 14.7 h`. */
  phrase: string;
}

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

export function etaParts(ms: number): EtaParts {
  const t = Math.max(0, ms);
  if (t < 90 * S) {
    const s = Math.round(t / S);
    return { value: String(s), unit: 's', phrase: `in ${s} s` };
  }
  if (t < H) {
    const m = Math.round(t / M);
    return { value: String(m), unit: 'min', phrase: `in ${m} min` };
  }
  if (t < 48 * H) {
    const h = (t / H).toFixed(1);
    return { value: h, unit: 'h', phrase: `in ${h} h` };
  }
  const d = Math.floor(t / D);
  const hr = Math.floor((t % D) / H);
  const v = hr ? `${d}d ${hr}h` : `${d}d`;
  return { value: v, unit: '', phrase: `in ${v}` };
}

export interface EtaClock {
  /** The leading figure and its unit: `12` `h`. */
  a: string;
  aUnit: string;
  /** The trailing figure and unit when there is one: `05` `m`. Zero padded so the width holds. */
  b?: string;
  bUnit?: string;
  /** For text and assistive technology: `in 12 h 5 min`. */
  phrase: string;
}

/**
 * A countdown in two figures that tick on their own: days and hours, hours and minutes, minutes and
 * seconds, or seconds alone. The trailing figure is zero padded, so tabular digits never shift.
 */
export function etaClock(ms: number): EtaClock {
  const t = Math.max(0, Math.round(ms / S));
  const d = Math.floor(t / 86_400);
  const h = Math.floor((t % 86_400) / 3_600);
  const m = Math.floor((t % 3_600) / 60);
  const s = t % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  if (d >= 1) return { a: String(d), aUnit: 'd', b: two(h), bUnit: 'h', phrase: `in ${d} d ${h} h` };
  if (h >= 1) return { a: String(h), aUnit: 'h', b: two(m), bUnit: 'm', phrase: `in ${h} h ${m} min` };
  if (m >= 1) return { a: String(m), aUnit: 'm', b: two(s), bUnit: 's', phrase: `in ${m} min ${s} s` };
  return { a: String(s), aUnit: 's', phrase: `in ${s} s` };
}

/** Compact text for a countdown: `12h 44m`, `3m 05s`, `28s`. */
export function etaShort(ms: number): string {
  const c = etaClock(ms);
  return c.b !== undefined ? `${c.a}${c.aUnit} ${c.b}${c.bUnit}` : `${c.a}${c.aUnit}`;
}

/** `8 min`, `3.2 h`, `2d 3h`: a span without the leading "in" (ages, durations). */
export function spanText(ms: number): string {
  const p = etaParts(ms);
  return p.unit ? `${p.value} ${p.unit}` : p.value;
}
