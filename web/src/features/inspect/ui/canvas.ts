// Small canvas helpers shared by the inspector canvases.

/** `#rrggbb` with an alpha (canvas gradients interpolate badly through `transparent`). */
export function withAlpha(color: string, a: number): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return `${color}${Math.round(Math.max(0, Math.min(1, a)) * 255)
      .toString(16)
      .padStart(2, '0')}`;
  }
  return color;
}

/** A CSS custom property resolved on `el`; `fallback` (the text colour) if the token is not set. */
export function readVar(el: Element, name: string, fallback = 'currentColor'): string {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/** Sizes a canvas to its CSS box at the device pixel ratio (capped at 2) and returns a context drawn in CSS px. */
export function fitCanvas(cv: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (cv.width !== pw || cv.height !== ph) {
    cv.width = pw;
    cv.height = ph;
  }
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
