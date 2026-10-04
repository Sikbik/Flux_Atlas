import { chainTicker } from '../lib/parallel';

/**
 * A chain's badge: its ticker set in a hexagon, in type only. Atlas draws no third-party logos; the ticker is the
 * name the chain goes by in a wallet, and the hexagon is Flux's own shape.
 */
export function ChainBadge({
  chain,
  size = 'md',
  inactive,
}: {
  chain: string;
  size?: 'sm' | 'md' | 'lg';
  inactive?: boolean;
}) {
  const ticker = chainTicker(chain);
  return (
    <span
      className="wl-chain"
      data-size={size}
      data-inactive={inactive || undefined}
      data-long={ticker.length > 3 || undefined}
    >
      <span className="wl-chain__text ui-mono">{ticker}</span>
    </span>
  );
}
