import { useTip } from '../../../app/context';
import { useNodeCtx } from './context';

/** Blocks since the node's last check-in (live table first, then the server's record); null when unknown. */
export function useSince(): number | null {
  const { node, live } = useNodeCtx();
  const tip = useTip();
  const lastConfirmed = Math.max(live?.lastConfirmed ?? 0, node?.last_confirmed_height ?? 0);
  return lastConfirmed && tip ? Math.max(0, tip.height - lastConfirmed) : null;
}
