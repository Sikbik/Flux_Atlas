// Inspectors (F3): node, host, app, operator, payment queue, network weather. Each view is a lazy
// chunk (React.lazy), so the shell stays small and an inspector's code loads when its window opens.

import { lazy } from 'react';

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

export const OperatorView = lazy(() =>
  import('../features/inspect/operator/OperatorView').then((m) => ({ default: m.OperatorView })),
);

export const WeatherView = lazy(() =>
  import('../features/inspect/weather/WeatherView').then((m) => ({ default: m.WeatherView })),
);

/**
 * Raises toasts (and, when the user opted in, browser notifications) for changes to watched nodes. It
 * renders nothing and runs once however many copies are mounted. Mount it once under the runtime and
 * router providers, inside a `Suspense` with a null fallback, so alerts reach the user with no inspector
 * open: `<Suspense fallback={null}><WatchAlerts /></Suspense>`.
 */
export const WatchAlerts = lazy(() =>
  import('../features/inspect/watch/WatchAlerts').then((m) => ({ default: m.WatchAlerts })),
);
