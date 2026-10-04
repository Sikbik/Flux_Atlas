// How wide a figure runs when it is set in the display face, in ems, so a tile can size the figure to fit (CSS cannot
// measure text). Measured on Montserrat Light with its tabular numerals and the display tracking: a digit takes
// 0.675 em, a separator (comma, point, space) 0.175 em. Anything else counts as a digit, the widest glyph, so the
// estimate errs toward a figure that is a little small rather than one that is clipped.

const DIGIT_EM = 0.675;
const MARK_EM = 0.175;

export function figureEm(text: string): number {
  let em = 0;
  for (const ch of text) em += ch === ',' || ch === '.' || ch === ' ' ? MARK_EM : DIGIT_EM;
  return em;
}
