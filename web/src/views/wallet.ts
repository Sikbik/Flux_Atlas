// The wallet workspace (`/wallet/$addr`): an operator's whole picture in one wide window. A lazy chunk, so the
// shell stays small and the workspace's code loads when its window first opens.

import { lazy } from 'react';

export const WalletView = lazy(() =>
  import('../features/wallet/WalletView').then((m) => ({ default: m.WalletView })),
);
