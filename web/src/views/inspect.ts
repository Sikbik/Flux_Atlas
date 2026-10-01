// Inspectors (F3): node, host, app, operator, payment queue, network weather. Each view is a lazy
// chunk (React.lazy), so the shell stays small and an inspector's code loads when its window opens.

import { lazy } from 'react';

export {
  AppHistoryView,
  AppView,
  HostView,
  OperatorView,
  QueueView,
  WeatherView,
} from '../app/placeholders/views';

export const NodeView = lazy(() =>
  import('../features/inspect/node/NodeView').then((m) => ({ default: m.NodeView })),
);
