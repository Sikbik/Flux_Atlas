import { createContext, useContext } from 'react';
import type { NodeDetailDto } from '../../../api/generated/NodeDetailDto';
import type { NodeDto } from '../../../api/generated/NodeDto';
import type { QueueTier } from '../derive/queue';
import type { NodeLive } from '../sources/live';

/** What every section of a node inspector reads: the route key, the resolved node and its facts. */
export interface NodeCtx {
  routeKey: string;
  id: number | null;
  detail: NodeDetailDto | undefined;
  node: NodeDto | undefined;
  live: NodeLive | null;
  tier: QueueTier | 'unknown';
  endpoint: string;
  ip: string | null;
  /** The key to ask the API about this node: the id once known, else the route key. */
  apiKey: string | number;
}

export const NodeContext = createContext<NodeCtx | null>(null);

export function useNodeCtx(): NodeCtx {
  const c = useContext(NodeContext);
  if (!c) throw new Error('useNodeCtx must be used inside a NodeView');
  return c;
}
