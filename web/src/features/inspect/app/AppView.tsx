import {
  Boxes,
  Check,
  Clock3,
  Download,
  ExternalLink,
  FileDiff,
  History,
  Lock,
  MapPin,
  Play,
  SearchX,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { useMemo } from 'react';
import { isApiError } from '../../../api/http';
import { useAppDetail } from '../../../api/queries';
import { useRuntime, useTip } from '../../../app/context';
import { formatAgo, formatInt, middleTruncate } from '../../../lib/format';
import { appExpiry, appStage, defaultAppDomain, formatGeoRules } from '../derive/appSpec';
import { useAppLive } from '../sources/apps';
import { readNodeLive, useChainClock } from '../sources/live';
import {
  Alert,
  AppHistoryLink,
  Btn,
  Chip,
  CopyButton,
  Digits,
  Disclosure,
  Disclosures,
  Grid,
  HeroCard,
  type MapPoint,
  Meter,
  Sk,
  State,
  StatusChip,
  type Step,
  Stepper,
  Tile,
  useOpenSet,
} from '../ui';
import { AppContext, type AppCtx, useAppCtx } from './context';
import { HistoryList, useRevisions } from './History';
import { InstancesBody } from './Instances';
import { ComponentsBody, OwnerBody, PlacementBody } from './Spec';
import './app.css';

const DAY_MS = 86_400_000;
const plural = (n: number, one: string, many = `${one}s`) => `${formatInt(n)} ${n === 1 ? one : many}`;

function AppSkeleton() {
  return (
    <article className="ix ix-app" aria-busy="true" aria-label="Loading the app">
      <header className="ix-hero">
        <div className="ix-hero-card">
          <Sk h={176} r={0} />
        </div>
      </header>
      <div className="ix-lead">
        <Sk h={66} r={12} />
        <div className="ix-gap">
          <Sk h={96} r={14} />
        </div>
      </div>
    </article>
  );
}

/** An app whose registration is broadcast but not mined: nothing to inspect yet but where it is in its life. */
function PendingApp({ name }: { name: string }) {
  const live = useAppLive(name);
  const { nowMs } = useChainClock();
  const p = live.pending;
  if (!p) return null;
  const mined = p.state === 'mined';
  const expired = p.state === 'expired';
  const left = Math.max(0, p.expiresMs - nowMs);
  const steps: Step[] = [
    {
      key: 'pending',
      label: 'Pending',
      sub: mined ? 'mined' : expired ? 'not mined' : 'broadcast',
      icon: Clock3,
    },
    { key: 'confirmed', label: 'Confirmed', sub: mined ? 'indexing' : '', icon: Check },
    { key: 'installing', label: 'Installing', sub: '', icon: Download },
    { key: 'running', label: 'Running', sub: '', icon: Play },
  ];
  return (
    <article className="ix ix-app" aria-label={`${name}, pending`}>
      <header className="ix-hero">
        <HeroCard
          points={[]}
          mapLabel=""
          chips={
            <StatusChip tone={expired ? 'off' : 'pending'} icon={expired ? 'dashed' : 'pending'}>
              {expired ? 'Not mined' : mined ? 'Mined, indexing' : 'Pending'}
            </StatusChip>
          }
          title={name}
          sub={p.kind === 'register' ? 'A new app registration' : 'An update to the app'}
        />
      </header>
      <div className="ix-lead">
        <Stepper steps={steps} at={mined ? 1 : 0} label="App lifecycle" />
        <p className="ix-cap">
          {expired
            ? `The message was not mined before it expired ${formatAgo(nowMs - p.expiresMs)}. Nothing was registered.`
            : mined
              ? 'The payment is mined. The app appears here as soon as the index has its specification.'
              : `The signed message was broadcast ${formatAgo(nowMs - p.receivedMs)} and waits for its payment to be mined. It expires in ${Math.ceil(left / 60_000)} min if it is not.`}
        </p>
      </div>
    </article>
  );
}

function HistoryRow() {
  const { name } = useAppCtx();
  const rev = useRevisions(name);
  const { clock } = useRuntime();
  let lastTime: number | null = null;
  for (const it of rev.items) if (it.type !== 'renewals') lastTime = it.entry.time_ms ?? lastTime;
  if (rev.pending) return <Sk h={12} w={160} />;
  return (
    <span>
      <span className="ix-mono">{rev.total}</span> {rev.total === 1 ? 'revision' : 'revisions'}
      {lastTime ? ` · last changed ${formatAgo(clock.now() - lastTime)}` : ''}
    </span>
  );
}

function HistoryBody() {
  const { name } = useAppCtx();
  const rev = useRevisions(name);
  if (rev.pending) {
    return (
      <div className="ix-hist" aria-hidden="true">
        <Sk h={40} />
        <Sk h={40} />
      </div>
    );
  }
  return <HistoryList name={name} items={rev.items} limit={5} />;
}

function AppBody() {
  const ctx = useAppCtx();
  const { detail, live, tip } = ctx;
  const { spec } = detail;
  const { store } = useRuntime();
  const open = useOpenSet('app', ['instances']);
  const rev = useRevisions(detail.name);

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

  const stageChip =
    stage.stage === 'running'
      ? { tone: 'ok', icon: 'check', label: 'Running' }
      : stage.stage === 'installing'
        ? { tone: 'pending', icon: 'pending', label: 'Installing' }
        : stage.stage === 'confirmed'
          ? { tone: 'off', icon: 'dashed', label: 'Not running' }
          : { tone: 'pending', icon: 'pending', label: 'Pending' };

  const steps: Step[] = [
    {
      key: 'pending',
      label: 'Pending',
      sub: stage.pendingUpdate ? 'update waiting' : 'mined',
      icon: Clock3,
    },
    { key: 'confirmed', label: 'Confirmed', sub: `block ${formatInt(detail.height)}`, icon: Check },
    {
      key: 'installing',
      label: 'Installing',
      sub:
        installing > 0
          ? `${installing} now`
          : running >= target
            ? 'done'
            : `${Math.max(0, target - running)} to go`,
      icon: Download,
    },
    { key: 'running', label: 'Running', sub: `${running} of ${target}`, icon: Play },
  ];
  const at = ['pending', 'confirmed', 'installing', 'running'].indexOf(stage.stage);

  const days = expiry ? Math.floor(expiry.msLeft / DAY_MS) : null;
  const url = defaultAppDomain(detail.name);
  const resHidden = spec.enterprise || (detail.totals.cpu === 0 && detail.totals.ram_mb === 0);
  const ramGb = detail.totals.ram_mb / 1024;

  return (
    <article className="ix ix-app" data-stage={stage.stage} aria-label={`App ${detail.display_name}`}>
      <header className="ix-hero">
        <HeroCard
          points={points}
          world={points.length > 1}
          minSpan={22}
          mapLabel={`Where ${detail.display_name} runs`}
          chips={
            <>
              <StatusChip tone={stageChip.tone as 'ok'} icon={stageChip.icon as 'check'}>
                {stageChip.label}
              </StatusChip>
              {spec.enterprise ? (
                <Chip icon={<Lock size={13} strokeWidth={1.75} />} title="The specification is encrypted">
                  Enterprise
                </Chip>
              ) : null}
              <Chip mono title="Spec version">
                v{spec.spec_version}
              </Chip>
              {expiry?.state === 'soon' ? (
                <StatusChip tone="warn" icon="alert">
                  Expiring soon
                </StatusChip>
              ) : expiry?.state === 'expired' ? (
                <StatusChip tone="crit" icon="x">
                  Expired
                </StatusChip>
              ) : null}
            </>
          }
          title={detail.display_name}
          sub={spec.description || undefined}
        />
        <div className="ix-actions ix-hero-actions">
          {running > 0 ? (
            <a
              className="ix-btn"
              href={`https://${url}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${url}`}
            >
              <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
              Open app
            </a>
          ) : null}
          {rev.total > 0 ? (
            <AppHistoryLink name={detail.name} n={rev.total} className="ix-btn" title="Every spec revision">
              <FileDiff size={14} strokeWidth={1.75} aria-hidden="true" />
              Spec history
            </AppHistoryLink>
          ) : null}
          <span className="ix-actions-gap" aria-hidden="true" />
          <span className="ix-actions-copy">
            <CopyButton value={detail.display_name} label="Copy the app name" />
          </span>
        </div>
      </header>

      <div className="ix-lead ix-rise" style={{ '--ix-i': 1 } as React.CSSProperties}>
        <Stepper steps={steps} at={at} label="App lifecycle" />
        <Grid cols={3}>
          <Tile
            label="Instances"
            value={<Digits value={String(running)} />}
            unit={`of ${target}`}
            detail={
              installing > 0
                ? `${installing} installing`
                : running >= target
                  ? 'at target'
                  : `${target - running} short`
            }
            detailTone={installing > 0 ? 'accent' : running < target ? 'warn' : undefined}
          >
            <Meter
              value={target > 0 ? running / target : null}
              kind="locked"
              label="Instances running against the target"
            />
          </Tile>
          <Tile
            label="Expires"
            value={days === null ? 'Unknown' : <Digits value={formatInt(days)} />}
            unit={days === null ? undefined : days === 1 ? 'day' : 'days'}
            detail={`block ${formatInt(detail.expire_height)}`}
            detailTone={expiry?.state === 'soon' ? 'warn' : undefined}
          >
            <Meter
              value={expiry ? expiry.fractionLeft : null}
              kind="locked"
              label="Share of the paid lifetime left"
            />
          </Tile>
          <Tile
            label="Footprint"
            value={
              resHidden ? 'Hidden' : <Digits value={ramGb >= 10 ? ramGb.toFixed(0) : ramGb.toFixed(1)} />
            }
            unit={resHidden ? undefined : 'GB RAM'}
            detail={
              resHidden
                ? 'encrypted spec'
                : `${formatInt(detail.totals.cpu)} CPU · ${formatInt(detail.totals.hdd_gb)} GB`
            }
          />
        </Grid>
        {expiry && expiry.state !== 'ok' ? (
          <div className="ix-gap">
            <Alert
              tone={expiry.state === 'expired' ? 'crit' : 'warn'}
              title={
                expiry.state === 'expired'
                  ? 'Expired'
                  : `Expires in ${days === 0 ? 'under a day' : plural(days ?? 0, 'day')}`
              }
              icon={<WifiOff size={16} strokeWidth={1.75} />}
            >
              Unless the owner renews it, the network stops the app and removes its instances.
            </Alert>
          </div>
        ) : null}
      </div>

      <Disclosures>
        <Disclosure
          index={2}
          title="Instances"
          icon={<MapPin size={15} strokeWidth={1.75} />}
          summary={
            <span>
              <span className="ix-mono">{running}</span> of <span className="ix-mono">{target}</span> running
              {countries ? ` · ${plural(countries, 'country', 'countries')}` : ''}
              {installing ? ` · ${installing} installing` : ''}
            </span>
          }
          open={open.isOpen('instances')}
          onToggle={(v) => open.setOpen('instances', v)}
        >
          <InstancesBody />
        </Disclosure>
        <Disclosure
          index={3}
          title="Components"
          icon={<Boxes size={15} strokeWidth={1.75} />}
          summary={
            spec.enterprise ? (
              <span>Encrypted, not public</span>
            ) : (
              <span>
                <span className="ix-mono">{spec.components.length}</span>{' '}
                {spec.components.length === 1 ? 'component' : 'components'}
                {spec.components[0] ? ` · ${spec.components[0].repotag}` : ''}
              </span>
            )
          }
          open={open.isOpen('components')}
          onToggle={(v) => open.setOpen('components', v)}
        >
          <ComponentsBody />
        </Disclosure>
        <Disclosure
          index={4}
          title="Placement rules"
          icon={<MapPin size={15} strokeWidth={1.75} />}
          summary={
            <span>
              {spec.geolocation.length
                ? formatGeoRules(spec.geolocation)
                : spec.static_ip || spec.nodes.length || spec.datacenter !== null
                  ? 'Host requirements'
                  : 'Anywhere'}
            </span>
          }
          open={open.isOpen('placement')}
          onToggle={(v) => open.setOpen('placement', v)}
        >
          <PlacementBody />
        </Disclosure>
        <Disclosure
          index={5}
          title="Spec history"
          icon={<History size={15} strokeWidth={1.75} />}
          summary={<HistoryRow />}
          open={open.isOpen('history')}
          onToggle={(v) => open.setOpen('history', v)}
        >
          <HistoryBody />
        </Disclosure>
        <Disclosure
          index={6}
          title="Owner and details"
          icon={<UserRound size={15} strokeWidth={1.75} />}
          summary={
            <span>
              Owned by <span className="ix-mono">{middleTruncate(spec.owner, 6, 4)}</span>
            </span>
          }
          open={open.isOpen('owner')}
          onToggle={(v) => open.setOpen('owner', v)}
        >
          <OwnerBody />
        </Disclosure>
      </Disclosures>
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
        <article className="ix ix-app" aria-label="App not found">
          <State
            icon={<SearchX size={20} strokeWidth={1.5} />}
            tone={notFound ? undefined : 'crit'}
            title={notFound ? 'No app with that name' : 'Could not load the app'}
            action={
              notFound ? undefined : (
                <Btn variant="primary" onClick={() => void q.refetch()}>
                  Try again
                </Btn>
              )
            }
          >
            {notFound
              ? `Nothing in the app index is named ${name}. Names are not case sensitive.`
              : 'The server did not answer; the rest of Atlas keeps running. Try again in a moment.'}
          </State>
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
