// Inspectors (F3): node, host, app, operator, payment queue, network weather. Each view is a lazy
// chunk (React.lazy), so the shell stays small and an inspector's code loads when its window opens.

import { lazy } from 'react';

export { OperatorView, WeatherView } from '../app/placeholders/views';

export const NodeView = lazy(() =>
  import('../features/inspect/node/NodeView').then((m) => ({ default: m.NodeView })),
);

export const HostView = lazy(() =>
  import('../features/inspect/host/HostView').then((m) => ({ default: m.HostView })),
);

export const AppView = lazy(() =>
  import('../features/inspect/app/AppView').then((m) => ({ default: m.AppView })),
);

export const AppHistoryView = lazy(() =>
  import('../features/inspect/app/History').then((m) => ({ default: m.AppHistoryView })),
);

export const QueueView = lazy(() =>
  import('../features/inspect/queue/QueueView').then((m) => ({ default: m.QueueView })),
);
