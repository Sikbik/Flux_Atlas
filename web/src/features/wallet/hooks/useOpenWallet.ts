import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

/**
 * Opens an address in the wallet workspace (`/wallet/$addr`), leaving the camera, layers and filters in the URL alone
 * (a stale selection goes, and so does another view's tab, which the workspace would not understand). It is the way
 * the operator panel and an address page lead to the workspace.
 */
export function useOpenWallet(): (addr: string) => void {
  const navigate = useNavigate();
  return useCallback(
    (addr: string) => {
      void navigate({
        to: '/wallet/$addr',
        params: { addr },
        search: ((prev: Record<string, unknown>) => ({ ...prev, sel: undefined, tab: undefined })) as never,
      });
    },
    [navigate],
  );
}
