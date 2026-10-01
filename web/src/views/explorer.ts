// Explorer, analytics and time machine (F4). Every real view is lazy: its chunk loads when its
// window or page first opens, so none of this weighs on the shell.

import { lazy } from 'react';

export { TimeMachineView } from '../app/placeholders/views';

export const AnalyticsView = lazy(() =>
  import('../features/analytics/views/AnalyticsView').then((m) => ({ default: m.AnalyticsView })),
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
