// The L2 lockup (design 5.1.4): the official logo, with "atlas" set exactly like the Flux brand book's
// "Flux foundation" lockup. Montserrat SemiBold, white on dark, 66.6 units in a lockup 335.661 units high,
// right-aligned to the wordmark's right edge (text anchored at its end at x 1080.361) with its baseline at
// y 88.237, so it sits above the "ux". The word is lower case. Nothing enters the lockup's clear space.

import { FLUX_LOGO_BLUE_WHITE } from '../../command/brand';

const W = 1080.361;
const H = 335.661;

export function LockupL2({ height = 70, className }: { height?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={(W / H) * height}
      height={height}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      focusable="false"
    >
      <title>Flux Atlas</title>
      <image href={FLUX_LOGO_BLUE_WHITE} width="1079.738" height={H} />
      <text
        x={W}
        y="88.237"
        textAnchor="end"
        fontSize="66.6"
        fontWeight="600"
        fill="#fff"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        atlas
      </text>
    </svg>
  );
}
