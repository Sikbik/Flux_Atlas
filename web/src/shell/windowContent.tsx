// What renders inside a window that is not the route's own (`?w=` extras and free windows). The
// route-bound primary window renders the router's <Outlet />; extras render from this registry, so
// the same view shows whether a window is primary or riding in `?w=`. Views come from the registry
// in src/views, where each feature team swaps its placeholders for real views.

import type { ReactNode } from 'react';
import { ANALYTICS_TABS, type AnalyticsTab, QUEUE_TIERS, type QueueTier } from '../app/search';
import {
  AboutView,
  AddressView,
  AnalyticsView,
  AppsView,
  AppView,
  BlockView,
  ExplorerView,
  HostView,
  MempoolView,
  NodesView,
  NodeView,
  OperatorView,
  QueueView,
  RichListView,
  SettingsView,
  SupplyView,
  TerminalView,
  TimeMachineView,
  TxView,
  WalletView,
  WeatherView,
} from '../views';
import type { WindowState } from './wm/types';

export function windowContent(win: WindowState): ReactNode {
  const k = win.key ?? '';
  switch (win.type) {
    case 'nodes':
      return <NodesView />;
    case 'node':
      return <NodeView nodeKey={k} />;
    case 'host':
      return <HostView ip={k} />;
    case 'apps':
      return <AppsView />;
    case 'app':
      return <AppView name={k} />;
    case 'explorer':
      return <ExplorerView />;
    case 'block':
      return <BlockView blockKey={k} />;
    case 'tx':
      return <TxView txid={k} />;
    case 'address':
      return <AddressView addr={k} />;
    case 'mempool':
      return <MempoolView />;
    case 'supply':
      return <SupplyView />;
    case 'richlist':
      return <RichListView />;
    case 'queue':
      return (
        <QueueView tier={(QUEUE_TIERS as readonly string[]).includes(k) ? (k as QueueTier) : undefined} />
      );
    case 'analytics':
      return (
        <AnalyticsView
          tab={(ANALYTICS_TABS as readonly string[]).includes(k) ? (k as AnalyticsTab) : 'overview'}
        />
      );
    case 'operator':
      return <OperatorView addr={k} />;
    case 'wallet':
      return <WalletView addr={k} />;
    case 'terminal':
      return <TerminalView />;
    case 'time':
      return <TimeMachineView />;
    case 'weather':
      return <WeatherView />;
    case 'about':
      return <AboutView />;
    case 'settings':
      return <SettingsView />;
  }
}
