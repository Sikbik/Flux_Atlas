// What apps pay: the FLUX paid to register and to update apps (a renewal is an update), over the last 30 days, with
// the change against the 30 days before, a sparkline of the daily figures, the day, week and all-time totals, and the
// app that paid the most. The payload says its figures are not known until the server has read the whole history of the
// permanent app messages, so until then the windows read Unknown (never zero), the totals say they are what has been
// seen so far, and a quiet line explains.

import { Coins, History } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import type { AppEconomyDto } from '../../../api/generated/AppEconomyDto';
import type { AppSpend } from '../../../api/generated/AppSpend';
import { fluxToNumber, formatInt } from '../../../lib/format';
import { ShellLink } from '../../../shell/frame/ShellLink';
import { Delta, Sparkline, Unknown } from '../../../ui';
import { formatDay } from '../../wallet/lib/dates';
import { HubPanel, type HubQuery, type PanelState } from '..';
import { Ghost, WaitAside } from './ghost';
import { type EconomyGlance, economyGlance, fluxShort } from './lib/economy';
import { GHOST_PAYER, ghostEconomy } from './lib/placeholders';
import { isWaiting, panelError, useMinute } from './parts';
import './economy.css';

const fluxText = (v: number | null): ReactNode =>
  v === null ? <Unknown /> : `${formatInt(Math.round(v))} FLUX`;
const countText = (v: number | null): ReactNode => (v === null ? <Unknown /> : formatInt(v));

type Payer = Pick<AppSpend, 'name' | 'display_name' | 'paid'>;

/**
 * What apps pay: the month as the one big figure, the sparkline, and the other windows as rows. The loading state draws
 * it too, from made-up numbers and a block where the sparkline goes.
 */
function EconomyBody({ g, top, spark }: { g: EconomyGlance; top: Payer | null; spark: ReactNode }) {
  return (
    <div className="ap-eco">
      <div className="ap-eco__lead">
        <p className="ap-eco__label" data-static>
          Paid in 30 days
        </p>
        <p className="ap-eco__big">
          {g.paid30d === null ? (
            <Unknown className="ap-eco__unknown" />
          ) : (
            <>
              <span className="ap-eco__v">{formatInt(Math.round(g.paid30d))}</span>
              <span className="ap-eco__unit" data-static>
                FLUX
              </span>
            </>
          )}
        </p>
        {g.change !== null ? (
          <Delta value={g.change * 100} kind="percent" decimals={1} period="vs the 30 days before" />
        ) : null}
      </div>

      {g.daily.length >= 2 && g.dailyFromMs !== null ? (
        <div className="ap-eco__trend">
          {spark}
          <p className="ap-eco__cap">
            FLUX paid each whole UTC day, from {formatDay(g.dailyFromMs)} to the day before today.
            {g.complete ? '' : ' Earlier days may read low.'}
          </p>
        </div>
      ) : null}

      {g.complete ? null : (
        <p className="ap-note" role="status">
          <History size={14} strokeWidth={1.5} aria-hidden="true" />
          <span>
            Still filling: the server has read only part of the app messages, so the day, week and month
            figures are not known yet.
          </span>
        </p>
      )}

      <dl className="ap-facts">
        <div>
          <dt data-static>Last 24 hours</dt>
          <dd>
            <span className="ap-facts__v">{fluxText(g.paid24h)}</span>
          </dd>
        </div>
        <div>
          <dt data-static>Last 7 days</dt>
          <dd>
            <span className="ap-facts__v">{fluxText(g.paid7d)}</span>
          </dd>
        </div>
        <div>
          <dt data-static>{g.complete ? 'All time' : 'Seen so far'}</dt>
          <dd>
            <span className="ap-facts__v">{fluxText(g.paidAllTime)}</span>
            <span className="ap-facts__n">
              {formatInt(g.messages)} {g.messages === 1 ? 'message' : 'messages'}
            </span>
          </dd>
        </div>
        <div>
          <dt data-static>Registered, 30 days</dt>
          <dd>
            <span className="ap-facts__v">{countText(g.registrations30d)}</span>
          </dd>
        </div>
        <div>
          <dt data-static>Updated, 30 days</dt>
          <dd>
            <span className="ap-facts__v">{countText(g.updates30d)}</span>
          </dd>
        </div>
        {top ? (
          <div>
            <dt data-static>Biggest payer, 30 days</dt>
            <dd>
              <ShellLink to={{ type: 'app', key: top.name }} className="ap-facts__link">
                {top.display_name || top.name}
              </ShellLink>
              <span className="ap-facts__n">{fluxText(fluxToNumber(top.paid))}</span>
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

export function EconomyPanel({ economy }: { economy: HubQuery<AppEconomyDto> }) {
  const e = economy.data;
  const now = useMinute();
  const g = useMemo(() => (e ? economyGlance(e, now) : null), [e, now]);
  const top = e && g?.complete ? (e.top_apps_30d[0] ?? null) : null;

  // Loading is the ready state with made-up numbers, so the footer is there and the panel does not grow when they arrive.
  const loading = !e && economy.isPending;
  const ghost = useMemo(() => (loading ? ghostEconomy(now) : null), [loading, now]);
  const state: PanelState = e
    ? e.history_complete && e.messages_total === 0
      ? 'empty'
      : 'ready'
    : loading
      ? 'ready'
      : 'error';

  const last = g && g.daily.length > 0 ? (g.daily[g.daily.length - 1] as number) : null;

  return (
    <HubPanel
      id="economy"
      span="third"
      fill="row"
      title="What apps pay"
      icon={Coins}
      aside={isWaiting(economy) ? <WaitAside what="The figures" /> : undefined}
      state={state}
      aria-busy={loading || undefined}
      error={economy.error}
      onRetry={() => void economy.refetch()}
      retrying={economy.isFetching}
      {...panelError(economy.error, 'what apps pay')}
      emptyIcon={Coins}
      emptyTitle="No app messages stored"
      emptyText="Nothing has been paid to register or update an app in the history this server holds."
      footer={<span className="ap-foot-note">FLUX paid to register and update apps.</span>}
    >
      {ghost ? (
        <Ghost>
          <EconomyBody g={ghost} top={GHOST_PAYER} spark={<div className="ap-eco__spark" />} />
        </Ghost>
      ) : g && e ? (
        <EconomyBody
          g={g}
          top={top}
          spark={
            <Sparkline
              values={g.daily}
              form="area"
              width="fluid"
              height={56}
              label={`FLUX paid per whole UTC day over the last ${formatInt(g.daily.length)} days${last === null ? '' : `, most recently ${fluxShort(last)}`}`}
            />
          }
        />
      ) : null}
    </HubPanel>
  );
}
