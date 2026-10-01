import { useTip } from '../../../app/context';
import { startBlocksLeft } from '../derive/expiry';
import { useNodeCtx } from './context';

/** Blocks since the node's last check-in (live table first, then the server's record); null when unknown. */
export function useSince(): number | null {
  const { node, live } = useNodeCtx();
  const tip = useTip();
  const lastConfirmed = Math.max(live?.lastConfirmed ?? 0, node?.last_confirmed_height ?? 0);
  return lastConfirmed && tip ? Math.max(0, tip.height - lastConfirmed) : null;
}

/** Blocks a started (unconfirmed) node has left before its start transaction expires; null when unknown. */
export function useStartLeft(): number | null {
  const { node } = useNodeCtx();
  const tip = useTip();
  return startBlocksLeft(tip?.height, node?.added_height);
}
