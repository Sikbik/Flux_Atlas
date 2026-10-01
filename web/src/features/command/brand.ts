// The official Flux brand files this feature draws, served from public/brand (the same place the shell's
// blue mark comes from). Names are the brand kit's own; nothing here is redrawn or recoloured.

const base = (file: string): string => `${import.meta.env.BASE_URL}brand/${file}`;

/** The symbol mark in white (the moon's row in the palette, the first achievement). */
export const FLUX_MARK_WHITE = base('Flux_symbol-mark_white.svg');
/** The round symbol, blue with the white mark (the ambient overlay's corner). */
export const FLUX_SYMBOL_BLUE_WHITE = base('Flux_symbol_blue-white.svg');
/** The logo lockup, blue and white (About). */
export const FLUX_LOGO_BLUE_WHITE = base('Flux_logo_blue_white.svg');
