// The Flux brand artwork the chrome draws: the official files from assets/brand/flux, unmodified and
// served from public/brand (design 5.1). The round symbol (blue disc, white glyph) is the L1 lockup's
// mark; the symbol mark (the four pieces, no disc) is Flux Gray at rest and white when hovered, open or
// focused (the dock's About item). Nothing here is tinted, glowed or animated in colour.

const base = import.meta.env.BASE_URL;

export const roundUrl = `${base}brand/Flux_symbol_blue-white.svg`;
export const whiteMarkUrl = `${base}brand/Flux_symbol-mark_white.svg`;
export const grayMarkUrl = `${base}brand/Flux_simbol-mark_gray.svg`;
export const blueMarkUrl = `${base}brand/Flux_symbol-mark_blue.svg`;

/** Width over height of the symbol mark (the four pieces) and of the round symbol. */
export const MARK_ASPECT = 279.714 / 322.975;
export const ROUND_ASPECT = 338.064 / 335.661;

/** The round symbol: Blue Wave disc, white glyph. 16 px is the smallest size anywhere (favicons aside). */
export function FluxRound({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <img
      className={className}
      src={roundUrl}
      alt=""
      width={Math.round(size * ROUND_ASPECT)}
      height={size}
      draggable={false}
    />
  );
}

/** The symbol mark in white (the moon's faces, boot). */
export function FluxMarkWhite({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <img
      className={className}
      src={whiteMarkUrl}
      alt=""
      width={Math.round(size * MARK_ASPECT)}
      height={size}
      draggable={false}
    />
  );
}

/** The symbol mark in the brand gray, crossfading to white (the parent sets `data-on`). */
export function FluxMarkToggle({ size = 20 }: { size?: number }) {
  const w = Math.round(size * MARK_ASPECT);
  return (
    <span className="flux-mark-toggle" style={{ width: w, height: size }} aria-hidden="true">
      <img src={grayMarkUrl} alt="" width={w} height={size} draggable={false} />
      <img src={whiteMarkUrl} alt="" width={w} height={size} draggable={false} />
    </span>
  );
}
