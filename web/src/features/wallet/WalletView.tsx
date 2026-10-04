// /wallet/$addr: everything about one payment address in one workspace. A head that says who and how it is doing,
// seven tabs (Overview, Earnings, Parallel assets, Fleet, Health and risk, Apps, Activity), and the actions that
// belong to the whole wallet (the globe, watching, the downloads, the currency). The wallet, the parallel assets and
// the prices are three queries that fail on their own; a failed one blanks its own figures, never the page.

import { useNavigate } from '@tanstack/react-router';
import { Eye, EyeOff, Globe, UserRoundX, WalletCards } from 'lucide-react';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { isApiError } from '../../api/http';
import { WALLET_TABS, type WalletTab } from '../../app/search';
import { formatInt } from '../../lib/format';
import { useWindowMeta } from '../../shell/wm/react';
import {
  EmptyState,
  EntityLink,
  ErrorState,
  Hash,
  IconButton,
  Skeleton,
  StatusChip,
  TabPanel,
  Tabs,
  TierChip,
  ViewHeader,
} from '../../ui';
import { useWatchMany } from '../inspect/sources/hooks';
import { type WalletCtx, WalletProvider } from './context';
import { useFleetRows } from './hooks/useFleetRows';
import { useGlobeActions } from './hooks/useGlobeActions';
import { useMoney } from './hooks/useMoney';
import { useParallelAssets, useWallet } from './hooks/useWallet';
import { attentionCount } from './lib/health';
import { ActivityTab } from './tabs/Activity';
import { AppsTab } from './tabs/Apps';
import { AssetsTab } from './tabs/Assets';
import { EarningsTab } from './tabs/Earnings';
import { FleetTab } from './tabs/Fleet';
import { HealthTab } from './tabs/Health';
import { OverviewTab } from './tabs/Overview';
import { PAY_TIERS } from './types';
import { CurrencySelect } from './ui/CurrencySelect';
import { ExportMenu } from './ui/ExportMenu';
import './wallet.css';

const LABELS: Record<WalletTab, string> = {
  overview: 'Overview',
  earnings: 'Earnings',
  assets: 'Parallel assets',
  fleet: 'Fleet',
  health: 'Health and risk',
  apps: 'Apps',
  activity: 'Activity',
};

const BASE = 'wallet';

/** The wallet's data is judged fresh for this long: a block that pays it, or two minutes of blocks, refetches. */
const CADENCE_MS = 120_000;

function Body({ tab }: { tab: WalletTab }) {
  switch (tab) {
    case 'overview':
      return <OverviewTab />;
    case 'earnings':
      return <EarningsTab />;
    case 'assets':
      return <AssetsTab />;
    case 'fleet':
      return <FleetTab />;
    case 'health':
      return <HealthTab />;
    case 'apps':
      return <AppsTab />;
    case 'activity':
      return <ActivityTab />;
  }
}

export interface WalletViewProps {
  addr: string;
  /** The tab the URL names (`?tab=`). */
  tab?: WalletTab;
  /** The window is the route's own: a tab change goes through the URL. Otherwise (a window riding in `?w=`) it is local. */
  routed?: boolean;
}

export function WalletView({ addr, tab: tabProp, routed }: WalletViewProps) {
  const wallet = useWallet(addr);
  const assets = useParallelAssets(addr);
  const money = useMoney();
  const { dto, query } = wallet;
  const fleet = useFleetRows(dto);
  const globe = useGlobeActions(fleet.nodes, fleet.rows);
  const navigate = useNavigate();
  const [local, setLocal] = useState<WalletTab>('overview');
  const tab: WalletTab = routed ? (tabProp ?? 'overview') : local;

  const setTab = useCallback(
    (next: WalletTab) => {
      if (!routed) {
        setLocal(next);
        return;
      }
      void navigate({
        to: '/wallet/$addr',
        params: { addr },
        search: ((prev: Record<string, unknown>) => ({
          ...prev,
          tab: next === 'overview' ? undefined : next,
        })) as never,
      });
    },
    [routed, navigate, addr],
  );

  const attention = dto ? attentionCount(dto.health.attention) : 0;
  const nodeCount = dto ? dto.nodes.length : 0;
  const apps = dto ? dto.apps.instances : 0;
  const tabItems = useMemo(
    () =>
      WALLET_TABS.map((id) => ({
        id,
        label: LABELS[id],
        badge:
          id === 'fleet' && nodeCount > 0
            ? nodeCount
            : id === 'health' && attention > 0
              ? attention
              : id === 'apps' && apps > 0
                ? apps
                : undefined,
      })),
    [nodeCount, attention, apps],
  );

  useWindowMeta({
    subtitle: dto
      ? `${formatInt(nodeCount)} ${nodeCount === 1 ? 'node' : 'nodes'}${attention > 0 ? `, ${formatInt(attention)} need attention` : ''}`
      : undefined,
    mono: true,
    fresh: dto
      ? { label: 'wallet', evidenceMs: query.dataUpdatedAt || null, cadenceMs: CADENCE_MS }
      : undefined,
  });

  // ---- before the data ----------------------------------------------------------------------------
  if (query.isPending) return <WalletSkeleton />;
  if (!dto) {
    const code = isApiError(query.error) ? query.error.code : null;
    if (code === 'bad_request' || code === 'not_found') {
      return (
        <article className="wl" aria-label="Wallet not found">
          <EmptyState
            icon={UserRoundX}
            title={
              code === 'bad_request' ? 'That is not a payment address' : 'Nothing is known at that address'
            }
            pattern
          >
            A wallet is a Flux payment address (a t1 or t3 address).{' '}
            <EntityLink kind="address" value={addr}>
              Open it in the explorer
            </EntityLink>
            .
          </EmptyState>
        </article>
      );
    }
    return (
      <article className="wl" aria-label="Wallet unavailable">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
      </article>
    );
  }

  const ctx: WalletCtx = {
    addr,
    dto,
    fetchedMs: query.dataUpdatedAt,
    money,
    assets,
    fleet,
    globe,
    landings: wallet.landings,
    tab,
    setTab,
  };

  return (
    <WalletProvider value={ctx}>
      <article className="wl" aria-label={`Wallet ${dto.address}`} data-tab={tab}>
        <WalletHeader ctx={ctx} />
        <div className="wl-tabs">
          <Tabs
            items={tabItems}
            value={tab}
            aria-label="Wallet sections"
            id={BASE}
            onChange={(next) => setTab(next)}
          />
        </div>
        <TabPanel tabsId={BASE} id={tab} value={tab}>
          <div className="wl-pagewrap">
            <Body tab={tab} />
          </div>
        </TabPanel>
      </article>
    </WalletProvider>
  );
}

/** The head: whose wallet, how it is doing, and the actions that belong to all of it. */
function WalletHeader({ ctx }: { ctx: WalletCtx }) {
  const { dto, fleet, globe, money, assets } = ctx;
  const ids = useMemo(() => fleet.nodes.filter((n) => n.present).map((n) => n.id), [fleet.nodes]);
  const watching = useWatchMany(ids);
  const attention = attentionCount(dto.health.attention);
  const total = dto.nodes.length;

  let health: ReactNode = null;
  if (total > 0) {
    health =
      attention === 0 ? (
        <StatusChip status="confirmed" label="All healthy" size="sm" />
      ) : (
        <StatusChip status="at-risk" label={`${formatInt(attention)} need attention`} size="sm" />
      );
  }

  return (
    <ViewHeader
      kind="Wallet"
      icon={WalletCards}
      title={<Hash value={dto.address} head={8} tail={6} what="payment address" />}
      mono
      subtitle={
        total === 0
          ? 'No node is paid to this address'
          : `${formatInt(total)} ${total === 1 ? 'node' : 'nodes'} paid to this address`
      }
      freshness={
        <span className="wl-tools">
          <IconButton
            size="sm"
            variant="secondary"
            icon={Globe}
            label={
              globe.onGlobe
                ? 'The fleet is shown on the globe. Press to hide it'
                : `Show the fleet on the globe (the ${formatInt(Math.min(total, 50))} paid soonest)`
            }
            aria-pressed={globe.onGlobe}
            disabled={total === 0 || !globe.ready}
            onClick={globe.toggle}
          />
          <IconButton
            size="sm"
            variant="secondary"
            icon={watching.all ? EyeOff : Eye}
            label={watching.all ? 'Stop watching this fleet' : 'Watch every node of this fleet'}
            aria-pressed={watching.all}
            disabled={ids.length === 0 || (!watching.all && watching.room === 0)}
            onClick={watching.toggle}
          />
          <ExportMenu dto={dto} rows={fleet.rows} money={money} assets={assets.data} />
          <CurrencySelect money={money} />
        </span>
      }
    >
      {health}
      {PAY_TIERS.slice()
        .reverse()
        .map((t) =>
          dto.tiers[t] > 0 ? (
            <TierChip
              key={t}
              tier={t}
              size="sm"
              label={`${formatInt(dto.tiers[t])} ${t.charAt(0).toUpperCase()}${t.slice(1)}`}
            />
          ) : null,
        )}
    </ViewHeader>
  );
}

function WalletSkeleton() {
  return (
    <article className="wl" aria-busy="true" aria-label="Loading the wallet">
      <div className="wl-skel-head">
        <Skeleton w={72} h={12} />
        <Skeleton w="58%" h={24} />
        <Skeleton w="42%" h={12} />
      </div>
      <div className="wl-skel-tabs">
        {[88, 76, 112, 60, 120, 56, 72].map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed set of placeholders
          <Skeleton key={i} w={w} h={20} radius={10} />
        ))}
      </div>
      <div className="wl-pagewrap">
        <div className="wl-page">
          <Skeleton h={156} radius={16} />
          <div className="wl-skel-dial">
            <Skeleton h="min(100%, 380px)" radius="50%" w="min(100%, 380px)" />
          </div>
          <Skeleton h={120} radius={16} />
        </div>
      </div>
    </article>
  );
}
