import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { canonicalNodeKey } from '../../../store/nodeKeys';

/**
 * Opens a node's page by its collateral outpoint, leaving the camera, layers and filters in the URL alone (a stale
 * selection goes, since the node is the selection now).
 */
export function useOpenNode(): (key: string) => void {
  const navigate = useNavigate();
  return useCallback(
    (key: string) => {
      void navigate({
        to: '/node/$key',
        params: { key: canonicalNodeKey(key) },
        search: ((prev: Record<string, unknown>) => ({ ...prev, sel: undefined })) as never,
      });
    },
    [navigate],
  );
}
