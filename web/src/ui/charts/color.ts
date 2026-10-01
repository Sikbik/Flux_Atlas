// Colour plumbing for canvas drawing. uPlot paints on a <canvas>, which cannot resolve `var(--x)`,
// so every colour a canvas chart uses is read from the design tokens at runtime (never hard-coded):
// `resolveColor` asks the browser what a CSS colour expression computes to, and `withAlpha` makes
// the translucent variants (area wash, glow) from the result.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^rgba?\(\s*([^)]+)\)$/i;

function channel(token: string): number | null {
  const t = token.trim();
  const n = t.endsWith('%') ? (Number.parseFloat(t) / 100) * 255 : Number.parseFloat(t);
  return Number.isFinite(n) ? Math.min(255, Math.max(0, n)) : null;
}

function alphaOf(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const t = token.trim();
  const n = t.endsWith('%') ? Number.parseFloat(t) / 100 : Number.parseFloat(t);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

/** Parses `#rgb`, `#rrggbb[aa]`, `rgb(r, g, b)`, `rgba(r, g, b, a)` and `rgb(r g b / a)`; null for anything else. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim();
  const hex = HEX.exec(s);
  if (hex) {
    let h = hex[1] as string;
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = FUNC.exec(s);
  if (!fn) return null;
  const parts = (fn[1] as string).split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const r = channel(parts[0] as string);
  const g = channel(parts[1] as string);
  const b = channel(parts[2] as string);
  const a = alphaOf(parts[3]);
  if (r === null || g === null || b === null || a === null) return null;
  return { r, g, b, a };
}

const round = (n: number) => Math.round(n);

/**
 * `color` at `alpha` of its own opacity, as a string a canvas accepts. Falls back to `color-mix`
 * when the input is a colour syntax this module does not parse (oklab, color()).
 */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  const c = parseColor(color);
  if (!c) return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
  return `rgba(${round(c.r)}, ${round(c.g)}, ${round(c.b)}, ${Math.round(c.a * a * 1000) / 1000})`;
}

/**
 * Resolves any CSS value of a property (a colour, `var(--viz-grid)`, a font size in rem) to what the
 * browser computes it to, by styling a throwaway element inside `host` so tokens cascade as they
 * would for the chart itself.
 */
export function resolveProperty(host: Element, property: 'color' | 'fontSize', value: string): string {
  if (typeof document === 'undefined') return value;
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;';
  probe.style[property] = value;
  host.appendChild(probe);
  const out = getComputedStyle(probe)[property];
  probe.remove();
  return out || value;
}

/** What a CSS colour expression (a token reference, `color-mix`, a name) computes to. */
export function resolveColor(host: Element, value: string): string {
  return resolveProperty(host, 'color', value);
}
