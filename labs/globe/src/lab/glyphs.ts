// Small original SVG glyphs shared by the lab overlays (the design's custom set, section 5.4).
// No emoji anywhere: marks and meters are drawn, not typed.

/** The Atlas mark: a flat-top hexagon holding a circle with one tilted orbit and a single bright node. */
export const ATLAS_MARK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M7.5 3.2h9L21 12l-4.5 8.8h-9L3 12z"/>
  <circle cx="12" cy="12" r="3.4"/>
  <ellipse cx="12" cy="12" rx="6.2" ry="2.3" transform="rotate(-28 12 12)" opacity="0.8"/>
  <circle cx="16.8" cy="9.1" r="1.25" fill="currentColor" stroke="none"/>
</svg>`;

/** Tier meter: three stacked capsules, bottom up; 1, 2 or 3 lit in the tier color. Always paired with a word. */
export function tierMeter(tier: number): string {
  const lit = tier === 3 ? 3 : tier === 2 ? 2 : 1;
  const r = (i: number): string => `<rect x="1" y="${8.6 - i * 4}" width="10" height="2.6" rx="1.3" class="${lit > i ? 'on' : ''}"/>`;
  return `<svg class="tier tier-${tier === 3 ? 3 : tier === 2 ? 2 : 1}" viewBox="0 0 12 12" aria-hidden="true">${r(0)}${r(1)}${r(2)}</svg>`;
}

/** A thin arrow for routes (producer to payee). */
export const ARROW = `<svg class="arr" viewBox="0 0 34 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 5h30M27 1.5 31.5 5 27 8.5"/></svg>`;
