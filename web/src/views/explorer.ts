// Explorer, analytics and time machine (F4). Every real view is lazy: its chunk loads when its
// window or page first opens, so none of this weighs on the shell.

import { lazy } from 'react';

export const AnalyticsView = lazy(() =>
  import('../features/analytics/views/AnalyticsView').then((m) => ({ default: m.AnalyticsView })),
);

/** The Explorer landing (`/explorer`): the hub of the chain, live. What the dock's Explorer launcher opens. */
export const ExplorerView = lazy(() =>
  import('../features/explorer/landing/ExplorerView').then((m) => ({ default: m.ExplorerView })),
);

export const BlockView = lazy(() =>
  import('../features/explorer/views/BlockView').then((m) => ({ default: m.BlockView })),
);
export const TxView = lazy(() =>
  import('../features/explorer/views/TxView').then((m) => ({ default: m.TxView })),
);
export const AddressView = lazy(() =>
  import('../features/explorer/views/AddressView').then((m) => ({ default: m.AddressView })),
);
export const MempoolView = lazy(() =>
  import('../features/explorer/views/MempoolView').then((m) => ({ default: m.MempoolView })),
);
export const SupplyView = lazy(() =>
  import('../features/explorer/views/SupplyView').then((m) => ({ default: m.SupplyView })),
);
export const RichListView = lazy(() =>
  import('../features/explorer/views/RichListView').then((m) => ({ default: m.RichListView })),
);

/** The time machine (`/time`): not a window; it opens the shell's timeline strip. */
export const TimeMachineView = lazy(() =>
  import('../features/timemachine/TimeMachineView').then((m) => ({ default: m.TimeMachineView })),
);
