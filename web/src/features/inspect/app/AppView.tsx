import {
  AppWindow,
  Boxes,
  Check,
  Clock3,
  Download,
  ExternalLink,
  History,
  MapPin,
  OctagonX,
  Play,
  SearchX,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useMemo } from 'react';
import { isApiError } from '../../../api/http';
import { useAppDetail } from '../../../api/queries';
import { useRuntime, useTip } from '../../../app/context';
import { formatAgo, formatInt, middleTruncate } from '../../../lib/format';
import {
  AnimatedNumber,
  Chip,
  CopyButton,
  EmptyState,
  ErrorState,
  RelativeTime,
  Section,
  Skeleton,
  Stat,
  StatGrid,
  StatusChip,
  ViewHeader,
} from '../../../ui';
import { appExpiry, appStage, defaultAppDomain } from '../derive/appSpec';
import { useAppLive } from '../sources/apps';
import { readNodeLive, useChainClock } from '../sources/live';
import { type Step, Stepper } from '../ui';
import { Callout } from '../ui/callout';
import { LocationMap } from '../ui/locationmap';
import type { MapPoint } from '../ui/map';
import { useOpenSet } from '../ui/openset';
import '../ui/parts.css';
import { AppContext, type AppCtx, useAppCtx } from './context';
import { HistoryPanel } from './History';
import { InstancesTable } from './Instances';
import { ExternalButton } from './links';
import { lastChangeMs, useRevisions } from './revisions';
import { ComponentsPanel, OwnerPanel, PlacementPanel } from './Spec';
import { componentsSummary, instancesSummary, placementSummary, plural } from './summary';
import './app.css';

const DAY_MS = 86_400_000;
const TRIO_MIN = 156;

function AppSkeleton() {
  return (
    <article className="ix ix-app" aria-busy="true" aria-label="Loading the app">
      <div className="ix-skel-head">
        <Skeleton w={64} h={12} />
        <Skeleton w="58%" h={24} />
        <Skeleton w="72%" h={12} />
      </div>
      <div className="ix-pad ix-gap-top">
        <Skeleton h={140} radius={14} />
      </div>
      <Section>
        <StatGrid min={TRIO_MIN} className="ix-app-trio">
          <Stat label="Instances" loading />
          <Stat label="Expires" loading />
          <Stat label="Footprint" loading />
        </StatGrid>
      </Section>
      <Section title="Instances">
        <div className="ix-skel-rows">
          <Skeleton h={34} />
          <Skeleton h={34} />
          <Skeleton h={34} />
        </div>
      </Section>
    </article>
  );
}

/** The stations an app passes through, from the first message to a running instance. */
function lifecycleSteps(sub: {
  pending: string;
  confirmed: string;
  installing: string;
  running: string;
}): Step[] {
  return [
    { key: 'pending', label: 'Pending', sub: sub.pending, icon: Clock3 },
    { key: 'confirmed', label: 'Confirmed', sub: sub.confirmed, icon: Check },
    { key: 'installing', label: 'Installing', sub: sub.installing, icon: Download },
    { key: 'running', label: 'Running', sub: sub.running, icon: Play },
  ];
}

/** A span of time as one figure and its unit: minutes from a minute up, else seconds. */
function figure(ms: number, round: (n: number) => number): { value: number; unit: string } {
  return ms >= 60_000
    ? { value: round(ms / 60_000), unit: 'min' }
    : { value: round(Math.max(0, ms) / 1000), unit: 's' };
}

/** An app whose registration is broadcast but not mined: nothing to inspect yet but where it is in its life. */
function PendingApp({ name }: { name: string }) {
  const live = useAppLive(name);
  const { nowMs } = useChainClock();
  const p = live.pending;
  if (!p) return null;
  const mined = p.state === 'mined';
  const expired = p.state === 'expired';
  const waited = figure(nowMs - p.receivedMs, Math.floor);
  const left = figure(p.expiresMs - nowMs, Math.ceil);
  const steps = lifecycleSteps({
    pending: mined ? 'mined' : expired ? 'not mined' : 'broadcast',
    confirmed: mined ? 'indexing' : '',
    installing: '',
    running: '',
  });
  return (
    <article className="ix ix-app" aria-label={`${name}, pending`}>
      <ViewHeader
        kind="App"
        icon={AppWindow}
        title={name}
        subtitle={p.kind === 'register' ? 'A new app registration' : 'An update to the app'}
      >
        <StatusChip
          status={expired ? 'unknown' : mined ? 'syncing' : 'pending'}
          label={expired ? 'Not mined' : mined ? 'Mined, indexing' : 'Pending'}
          size="sm"
        />
      </ViewHeader>
      {p.state === 'pending' ? (
        <Section>
          <StatGrid min={TRIO_MIN}>
            <Stat
              label="Waiting"
              value={<AnimatedNumber value={waited.value} roll={false} />}
              unit={waited.unit}
              caption="since it was broadcast"
            />
            <Stat
              label="Expires in"
              value={<AnimatedNumber value={left.value} roll={false} />}
              unit={left.unit}
              caption="if it is not mined"
            />
          </StatGrid>
        </Section>
      ) : null}
      <div className="ix-pad ix-gap-top">
        <Stepper steps={steps} at={mined ? 1 : 0} label="App lifecycle" />
        <p className="ix-cap">
          {expired
            ? `The message was not mined before it expired ${formatAgo(nowMs - p.expiresMs)}. Nothing was registered.`
            : mined
              ? 'The payment is mined. The app appears here as soon as the index has its specification.'
              : 'The signed message is broadcast and waits for its payment to be mined. The app appears here as soon as the index has its specification.'}
        </p>
      </div>
    </article>
  );
}

/** The latest revision's age, for the history fold's heading. */
function HistorySummary({ name }: { name: string }) {
  const rev = useRevisions(name);
  if (rev.pending) return null;
  const last = lastChangeMs(rev.items);
  return (
    <span className="ix-aside">
      {plural(rev.total, 'revision')}
      {last ? (
        <>
          {' '}
          · changed <RelativeTime ts={last} />
        </>
      ) : null}
    </span>
  );
}

function AppBody() {
  const ctx = useAppCtx();
  const { detail, live, tip } = ctx;
  const { spec } = detail;
  const { store } = useRuntime();
  const open = useOpenSet('app', ['instances']);

  const running = live.entry?.instances_running ?? detail.instances.length;
  const target = live.entry?.instances_target ?? spec.instances;
  const installing = live.installing.length;
  const stage = appStage({
    exists: true,
    running,
    target,
    installing,
    pending:
      live.pending && live.pending.state === 'pending'
        ? { kind: live.pending.kind, expiresMs: live.pending.expiresMs }
        : null,
  });
  const expiry = tip !== null ? appExpiry(detail.expire_height, detail.height, tip) : null;

  const points = useMemo<MapPoint[]>(
    () =>
      detail.instances
        .filter((i) => i.lat !== null && i.lon !== null)
        .map((i) => ({
          id: i.node ?? i.endpoint,
          lat: i.lat as number,
          lon: i.lon as number,
          tier: (i.node != null ? readNodeLive(store, i.node)?.tier : null) ?? 'unknown',
          size: 0.8,
        })),
    [detail.instances, store],
  );
  const countries = useMemo(
    () => new Set(detail.instances.map((i) => i.country_code).filter(Boolean)).size,
    [detail.instances],
  );

  const days = expiry ? Math.floor(expiry.msLeft / DAY_MS) : null;
  const url = defaultAppDomain(detail.name);
  const resHidden = spec.enterprise || (detail.totals.cpu === 0 && detail.totals.ram_mb === 0);
  const ramGb = detail.totals.ram_mb / 1024;

  const steps = lifecycleSteps({
    pending: stage.pendingUpdate ? 'update waiting' : 'mined',
    confirmed: `block ${formatInt(detail.height)}`,
    installing:
      installing > 0
        ? `${installing} now`
        : running >= target
          ? 'done'
          : `${Math.max(0, target - running)} to go`,
    running: `${running} of ${target}`,
  });
  const at = ['pending', 'confirmed', 'installing', 'running'].indexOf(stage.stage);
  // A running app needs no lifecycle diagram; one that is not, or has an update on its way, does.
  const showSteps = stage.stage !== 'running' || stage.pendingUpdate;

  return (
    <article className="ix ix-app" data-stage={stage.stage} aria-label={`App ${detail.display_name}`}>
      <ViewHeader
        kind="App"
        icon={AppWindow}
        title={detail.display_name}
        subtitle={spec.description ? <span className="ix-clamp">{spec.description}</span> : undefined}
        freshness={
          <span className="ix-app-tools">
            {running > 0 ? (
              <ExternalButton href={`https://${url}`} icon={ExternalLink} title={`Open ${url}`}>
                Open app
              </ExternalButton>
            ) : null}
            <CopyButton size="md" value={detail.display_name} what="the app name" />
          </span>
        }
      >
        {stage.stage === 'running' ? (
          <StatusChip status="confirmed" label="Running" size="sm" />
        ) : stage.stage === 'installing' ? (
          <StatusChip status="syncing" label="Installing" size="sm" />
        ) : stage.stage === 'confirmed' ? (
          <StatusChip status="unknown" label="Not running" size="sm" />
        ) : (
          <StatusChip status="pending" label="Pending" size="sm" />
        )}
        {spec.enterprise ? (
          <Chip size="sm" icon={ShieldCheck} title="The specification is encrypted">
            Enterprise
          </Chip>
        ) : null}
        <Chip mono size="sm" title="Spec version">
          v{spec.spec_version}
        </Chip>
        {expiry?.state === 'soon' ? (
          <StatusChip
            status="at-risk"
            label="Expiring soon"
            size="sm"
            title="Unless the owner renews it, the network stops the app and removes its instances"
          />
        ) : null}
        {expiry?.state === 'expired' ? <StatusChip status="expired" size="sm" /> : null}
      </ViewHeader>

      {points.length > 0 ? (
        <div className="ix-pad ix-gap-top">
          <LocationMap
            points={points}
            world={points.length > 1}
            minSpan={22}
            label={`Where ${detail.display_name} runs`}
            caption={
              <>
                <b>
                  {countries > 1
                    ? `Runs in ${plural(countries, 'country', 'countries')}`
                    : countries === 1
                      ? 'Runs in one country'
                      : `Located at ${plural(points.length, 'place')}`}
                </b>
                <span>
                  {formatInt(running)} of {formatInt(target)} instances
                </span>
              </>
            }
          />
        </div>
      ) : null}

      {showSteps ? (
        <div className="ix-pad ix-gap-top">
          <Stepper steps={steps} at={at} label="App lifecycle" />
        </div>
      ) : null}

      <Section>
        <StatGrid min={TRIO_MIN} className="ix-app-trio">
          <Stat
            label="Instances"
            value={<AnimatedNumber value={running} />}
            unit={`of ${formatInt(target)}`}
            caption={
              installing > 0
                ? `${installing} installing`
                : running >= target
                  ? 'at target'
                  : `${target - running} short`
            }
          />
          <Stat
            label="Expires"
            value={
              expiry === null ? null : expiry.state === 'expired' ? (
                'Expired'
              ) : (
                <AnimatedNumber value={days ?? 0} />
              )
            }
            unit={expiry === null || expiry.state === 'expired' ? undefined : days === 1 ? 'day' : 'days'}
            caption={`block ${formatInt(detail.expire_height)}`}
          />
          <Stat
            label="Footprint"
            value={
              resHidden ? (
                'Hidden'
              ) : (
                <AnimatedNumber
                  value={ramGb}
                  format={(n) => (n >= 10 ? n.toFixed(0) : n.toFixed(1))}
                  roll={false}
                />
              )
            }
            unit={resHidden ? undefined : 'GB RAM'}
            caption={
              resHidden
                ? 'encrypted spec'
                : `${formatInt(detail.totals.cpu)} CPU · ${formatInt(detail.totals.hdd_gb)} GB disk`
            }
          />
        </StatGrid>
      </Section>

      {expiry?.state === 'expired' ? (
        <div className="ix-pad ix-callouts">
          <Callout
            tone="crit"
            role="alert"
            icon={<OctagonX size={16} strokeWidth={1.5} />}
            title="Past its paid term"
          >
            Unless the owner renews it, the network stops the app and removes its instances.
          </Callout>
        </div>
      ) : null}

      <Section
        title="Instances"
        aside={
          <span className="ix-aside">{instancesSummary({ running, target, installing, countries })}</span>
        }
      >
        <InstancesTable />
      </Section>

      <Section
        collapsible
        level={3}
        icon={Boxes}
        title="Components"
        aside={
          <span className="ix-aside">
            {spec.enterprise
              ? 'Encrypted, not public'
              : componentsSummary(spec.components.map((c) => c.repotag))}
          </span>
        }
        open={open.isOpen('components')}
        onOpenChange={(v) => open.setOpen('components', v)}
      >
        <ComponentsPanel />
      </Section>

      <Section
        collapsible
        level={3}
        icon={MapPin}
        title="Placement rules"
        aside={<span className="ix-aside">{placementSummary(spec)}</span>}
        open={open.isOpen('placement')}
        onOpenChange={(v) => open.setOpen('placement', v)}
      >
        <PlacementPanel />
      </Section>

      <Section
        collapsible
        level={3}
        icon={History}
        title="Spec history"
        aside={<HistorySummary name={detail.name} />}
        open={open.isOpen('history')}
        onOpenChange={(v) => open.setOpen('history', v)}
      >
        <HistoryPanel name={detail.name} />
      </Section>

      <Section
        collapsible
        level={3}
        icon={UserRound}
        title="Owner and details"
        aside={<span className="ix-aside">Owned by {middleTruncate(spec.owner, 6, 4)}</span>}
        open={open.isOpen('owner')}
        onOpenChange={(v) => open.setOpen('owner', v)}
      >
        <OwnerPanel />
      </Section>
    </article>
  );
}

/**
 * The app inspector (`/app/:name`): where the app runs, its lifecycle (pending, confirmed, installing,
 * running), how long it is paid for, its components and placement rules, and its history of specs. An
 * enterprise app is labelled and shows public fields only.
 */
export function AppView({ name }: { name: string }) {
  const q = useAppDetail(name);
  const live = useAppLive(name);
  const tip = useTip();
  const detail = q.data;

  const ctx = useMemo<AppCtx | null>(
    () => (detail ? { name: detail.name, detail, live, tip: tip?.height ?? null } : null),
    [detail, live, tip],
  );

  if (!detail) {
    if (q.isError) {
      const notFound = isApiError(q.error) && q.error.code === 'not_found';
      if (notFound && live.pending) return <PendingApp name={name} />;
      return (
        <article className="ix ix-app" aria-label={notFound ? 'App not found' : 'App unavailable'}>
          {notFound ? (
            <EmptyState icon={SearchX} title="No app with that name" pattern>
              Nothing in the app index is named {name}. Names are not case sensitive.
            </EmptyState>
          ) : (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
          )}
        </article>
      );
    }
    return <AppSkeleton />;
  }
  return (
    <AppContext.Provider value={ctx}>
      <AppBody />
    </AppContext.Provider>
  );
}
