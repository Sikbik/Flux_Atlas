// Top node operators: who runs the nodes, ranked. An operator is a ZelID (or, when asked, a payment address): each
// row shows how many nodes it runs and its share of the network, the tier mix as a thin strip, the countries and
// providers its nodes sit in and where most of them are, what it earns a day at today's queue lengths (an estimate,
// main chain plus parallel assets unless the viewer chose main chain only), and how healthy its nodes are. The row opens the operator; the wallet link opens the wallet most of its nodes are
// paid to. The panel owns its states: the endpoint answers "wait" until the server knows the chain tip, and that is a
// wait state, not an error. While it loads, the panel draws the real list with made-up rows, footer included, so it
// has the size of the loaded one.

import { ChevronDown, ChevronUp, UserRoundCheck, WalletCards } from 'lucide-react';
import { type CSSProperties, useId, useMemo, useState } from 'react';
import type { OperatorsBy } from '../../../api/generated/OperatorsBy';
import { formatInt, shortAddress } from '../../../lib/format';
import { ShellLink } from '../../../shell/frame/ShellLink';
import { useUi } from '../../../store/ui';
import { Button, SegmentedControl } from '../../../ui';
import { BASIS_PHRASE, basisOf } from '../../earnings/basis';
import { EarningsBasis } from '../../earnings/EarningsBasis';
import { HubPanel, isFilling, LbBar, type LbColumn, Leaderboard, type PanelState, useOperators } from '..';
import {
  type ColumnTrack,
  listTracks,
  OPERATORS_ID,
  OPERATORS_SHOWN,
  type OperatorView,
  operatorsAside,
  operatorViews,
  type PlaceLeader,
  type TierMixPart,
  visibleOperators,
} from './lib/operators';
import { ghostOperators } from './lib/placeholders';
import { Redact, WaitAside } from './Redact';
import './operators.css';

const BY_OPTIONS = [
  { value: 'zelid', label: 'ZelID' },
  { value: 'address', label: 'Address' },
] as const satisfies readonly { value: OperatorsBy; label: string }[];

const GHOST = ghostOperators();

/** The tier mix as a thin strip of the tier colours; the words are there for a screen reader and the hover. */
function TierMix({ tiers, text }: { tiers: readonly TierMixPart[]; text: string }) {
  return (
    <span className="nd-mix" title={text}>
      <span className="ui-sr-only">{text}</span>
      <span className="nd-mix__bar" aria-hidden="true">
        {tiers
          .filter((t) => t.count > 0)
          .map((t) => (
            <i key={t.tier} data-tier={t.tier} style={{ flexGrow: t.count }} />
          ))}
      </span>
    </span>
  );
}

/** A count with the place or provider that holds most of the operator's nodes under it. */
function Place({ count, top }: { count: number; top: PlaceLeader | null }) {
  return (
    <span className="nd-place">
      <span className="nd-place__n">{formatInt(count)}</span>
      {top ? (
        <span className="nd-place__top" title={`${top.full}, ${top.pct}`}>
          <span className="ui-sr-only">most in </span>
          <span className="nd-place__name">{top.name}</span>
          <span className="nd-place__pct">{top.pct}</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * The share of an operator's nodes that are healthy, and what is wrong with the rest. Two lines are always set aside
 * for the problems (a node can be at risk and unreachable at once): side by side when the column is wide enough, one
 * over the other when it is not, and never cut. The DoS count, rare, rides on the first line.
 */
function HealthCell({ v }: { v: OperatorView }) {
  const tone = v.healthy >= 0.97 ? 'ok' : v.healthy >= 0.85 ? 'warn' : 'crit';
  const dos = v.problems.find((p) => p.kind === 'dos');
  const rest = v.problems.filter((p) => p.kind !== 'dos');
  return (
    <span className="nd-hc" title={v.problems.map((p) => p.text).join(', ') || undefined}>
      <span className="nd-hc__pct">
        <i className="nd-hc__dot" data-tone={tone} aria-hidden="true" />
        {v.healthText}
        {dos ? (
          <span className="nd-hc__dos">
            <span aria-hidden="true">{dos.short}</span>
            <span className="ui-sr-only">{dos.text}</span>
          </span>
        ) : null}
      </span>
      <span className="nd-hc__sub">
        {rest.length === 0
          ? dos
            ? null
            : 'no problems'
          : rest.map((p) => (
              <span key={p.kind} data-kind={p.kind}>
                {p.text}
              </span>
            ))}
      </span>
    </span>
  );
}

/** The second line of the name: when it began, and that it has no ZelID. Whole items, so one that does not fit goes. */
function NameSub({ v }: { v: OperatorView }) {
  const text = [v.since, v.grouping].filter(Boolean).join(', ');
  return (
    <span className="nd-idsub" title={text || undefined}>
      {v.since ? <span>{v.since}</span> : null}
      {v.grouping ? <span>{v.grouping}</span> : null}
    </span>
  );
}

/** The ranked list: the real rows, or the made-up ones of the loading state. */
function OperatorsList({ rows, by, max }: { rows: readonly OperatorView[]; by: OperatorsBy; max: number }) {
  const columns: (LbColumn<OperatorView> & ColumnTrack)[] = [
    {
      id: 'nodes',
      header: 'Nodes',
      width: 'minmax(96px, 1fr)',
      low: 'minmax(88px, 1fr)',
      cell: (v) => (
        <LbBar
          value={v.nodes}
          max={max}
          text={
            <>
              <span>{formatInt(v.nodes)}</span>
              <span className="nd-muted">{v.shareText}</span>
            </>
          }
        />
      ),
    },
    {
      id: 'tiers',
      header: 'Tier mix',
      width: 'minmax(72px, 0.8fr)',
      low: 'minmax(64px, 0.8fr)',
      cell: (v) => <TierMix tiers={v.tiers} text={v.tiersText} />,
    },
    {
      id: 'countries',
      header: 'Countries',
      width: 'minmax(92px, 1fr)',
      hide: 'narrow',
      cell: (v) => <Place count={v.countries} top={v.topCountry} />,
    },
    {
      id: 'providers',
      header: 'Providers',
      width: 'minmax(108px, 1.1fr)',
      hide: 'compact',
      cell: (v) => <Place count={v.providers} top={v.topProvider} />,
    },
    {
      id: 'rate',
      header: 'FLUX a day',
      width: '80px',
      align: 'end',
      cell: (v) => (
        <span
          className="nd-rate"
          title={
            v.nativePerDay === null
              ? "An estimate: its nodes at today's queue lengths"
              : `An estimate at today's queue lengths: ${v.nativePerDay.toFixed(2)} FLUX on the main chain${v.paPerDay === null ? '' : `, ${v.paPerDay.toFixed(2)} in parallel assets`}`
          }
        >
          {v.perDayText}
          <span className="ui-sr-only"> (an estimate)</span>
        </span>
      ),
    },
    {
      id: 'health',
      header: 'Healthy',
      width: 'minmax(150px, 1.4fr)',
      mid: 'minmax(140px, 1.3fr)',
      low: 'minmax(116px, 1.2fr)',
      cell: (v) => <HealthCell v={v} />,
    },
  ];
  // The tracks of each step of the list (see operators.css): without the providers, and without the countries too.
  const steps = {
    '--nd-t-mid': listTracks(columns, ['compact']),
    '--nd-t-low': listTracks(columns, ['compact', 'narrow']),
  } as CSSProperties;
  return (
    <div style={steps}>
      <Leaderboard
        label={`Top node operators by ${by === 'zelid' ? 'ZelID' : 'payment address'}`}
        rows={rows}
        rowKey={(v) => v.key}
        rank={(v) => v.rank}
        to={(v) => ({ type: 'operator', key: v.key })}
        linkLabel={(v) =>
          `Open operator ${v.name}${v.grouping ? ` (${v.grouping})` : ''}, ${formatInt(v.nodes)} ${v.nodes === 1 ? 'node' : 'nodes'}`
        }
        identity={(v) => <span className="nd-op__name">{v.name}</span>}
        identitySub={(v) => <NameSub v={v} />}
        columns={columns}
        actions={(v) =>
          v.walletAddress ? (
            <ShellLink
              to={{ type: 'wallet', key: v.walletAddress }}
              className="nd-wallet"
              aria-label={`Open the wallet ${shortAddress(v.walletAddress)}, where most of ${v.name}'s nodes are paid`}
              title="The wallet most of its nodes are paid to"
            >
              <WalletCards size={14} strokeWidth={1.5} aria-hidden="true" />
            </ShellLink>
          ) : null
        }
      />
    </div>
  );
}

export function OperatorsPanel() {
  const [by, setBy] = useState<OperatorsBy>('zelid');
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const q = useOperators(by);
  const includePa = useUi((s) => s.includePa);
  const views = useMemo(() => operatorViews(q.data, includePa), [q.data, includePa]);
  const shown = useMemo(() => visibleOperators(views, expanded), [views, expanded]);
  const max = useMemo(() => views.reduce((m, v) => Math.max(m, v.nodes), 0), [views]);

  // Loading is the ready state with made-up rows, so the footer is there and the panel does not grow when they arrive.
  const loading = q.isPending;
  const waiting = loading && isFilling(q.failureReason);
  const filling = isFilling(q.error);
  const state: PanelState = q.data ? (views.length === 0 ? 'empty' : 'ready') : loading ? 'ready' : 'error';

  return (
    <HubPanel
      id={OPERATORS_ID}
      className="nd-ops"
      span="full"
      title="Top node operators"
      icon={UserRoundCheck}
      aside={q.data ? operatorsAside(q.data) : waiting ? <WaitAside what="The operators" /> : undefined}
      actions={
        <>
          <EarningsBasis size="sm" />
          <SegmentedControl<OperatorsBy>
            size="sm"
            aria-label="Group operators by"
            options={BY_OPTIONS}
            value={by}
            onChange={setBy}
          />
        </>
      }
      state={state}
      flush
      aria-busy={loading || undefined}
      error={q.error}
      onRetry={() => void q.refetch()}
      retrying={q.isFetching}
      errorTitle={filling ? 'The operators are still being read' : 'Could not load the operators'}
      errorText={
        filling
          ? 'The server is reading the chain tip for the first time; try again in a moment.'
          : 'The ranking is built by this server from the node list; try again in a moment.'
      }
      emptyIcon={UserRoundCheck}
      emptyTitle="No operators yet"
      emptyText="The server has no confirmed nodes to group into operators."
      footer={
        state === 'ready' ? (
          <>
            {loading ? (
              <Redact>
                <Button size="sm" variant="ghost" icon={ChevronDown}>
                  Show all 25
                </Button>
              </Redact>
            ) : views.length > OPERATORS_SHOWN ? (
              <Button
                size="sm"
                variant="ghost"
                icon={expanded ? ChevronUp : ChevronDown}
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? `Show the top ${OPERATORS_SHOWN}` : `Show all ${formatInt(views.length)}`}
              </Button>
            ) : (
              <span />
            )}
            <span className="nd-foot-note">
              {by === 'address'
                ? 'Grouped by the address nodes are paid to; one operator can use several. '
                : 'An operator is a ZelID; nodes that report none are grouped by payment address. '}
              FLUX a day is an estimate from today&apos;s queue lengths, {BASIS_PHRASE[basisOf(includePa)]}.
            </span>
          </>
        ) : undefined
      }
    >
      <div
        id={listId}
        className="nd-ops__list"
        data-stale={q.isPlaceholderData || undefined}
        aria-busy={q.isPlaceholderData || undefined}
      >
        {loading ? (
          <Redact>
            <OperatorsList rows={GHOST} by={by} max={400} />
          </Redact>
        ) : (
          <OperatorsList rows={shown} by={by} max={max} />
        )}
      </div>
    </HubPanel>
  );
}
