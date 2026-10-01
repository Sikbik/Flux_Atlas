// The ArcaneOS mark: a pointy-top hexagon with an upward chevron. Original SVG on the 24 px grid, drawn in
// the surrounding text colour (the kit has the tier meter; this one is the inspectors' own).

export function ArcaneGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" />
      <path d="M8.5 13.2L12 9.6l3.5 3.6" />
    </svg>
  );
}
