// The Flux symbol as its four pieces (the official artwork, path data unchanged), so each can take its own
// tone. Used by the About anatomy: all four in the brand book's tonal faces, or one piece lit and the rest
// in Flux Graphite. Decorative: the legend beside it carries the meaning in words.

import type { PieceKey } from './model';

/** The four paths of Flux_symbol-mark_white.svg, with their own transforms. */
const PIECES: readonly { key: PieceKey; d: string; transform: string }[] = [
  {
    key: 'bar',
    d: 'M175.03,202.425l-28.9,16.7L84.03,183.28l28.2-16.285.7-.414,1.077.622Z',
    transform: 'translate(-6.271 103.85)',
  },
  {
    key: 'cap',
    d: 'M326.213,116.8v33.607L265.09,115.125l-16.576-9.572-16.576,9.572-77.7,44.858-16.576,9.572v19.787l-29.9-17.259-16.576-9.572-16.576,9.572L46.5,188.307V116.8L186.356,36.06Z',
    transform: 'translate(-46.5 -36.06)',
  },
  {
    key: 'big',
    d: 'M261.9,132.948v89.715l-77.7,44.858-.1-.062-77.594-44.8V132.948L184.2,88.07Z',
    transform: 'translate(17.819 19.693)',
  },
  {
    key: 'small',
    d: 'M135.884,141.366v51.591L91.192,218.774,46.5,192.957V141.366l44.692-25.8Z',
    transform: 'translate(-46.5 49.17)',
  },
];

export function FluxPieces({
  height,
  lit,
  className,
}: {
  /** Rendered height in px; the width follows the symbol's own proportions. */
  height: number;
  /** One piece in its tonal face and the others in graphite; omitted, all four are tonal. */
  lit?: PieceKey;
  className?: string;
}) {
  return (
    <svg
      className={`fp${className ? ` ${className}` : ''}`}
      width={(279.714 / 322.975) * height}
      height={height}
      viewBox="0 0 279.714 322.975"
      aria-hidden="true"
      focusable="false"
      data-lit={lit}
    >
      {PIECES.map((p) => (
        <path key={p.key} className={`fp-pc fp-${p.key}`} d={p.d} transform={p.transform} />
      ))}
    </svg>
  );
}
