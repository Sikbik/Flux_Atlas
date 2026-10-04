// The wallet's signature view: when each node is next paid. The dial lays the payments on a ring that reads from
// now; the list beside it names the ones coming first. Pointing at a node (on the ring or in the list) pings it on
// the globe. A payment that lands while the page is open is announced here and sends a ring out from the dial's hub.

import { CircleCheck } from 'lucide-react';
import { useMemo } from 'react';
import { formatInt, shortCollateral } from '../../../../lib/format';
import { useFresh } from '../../../../motion';
import { EntityLink, RelativeTime, SegmentedControl, TierGlyph } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { useBoundaryMs } from '../../hooks/useBoundary';
import { useOpenNode } from '../../hooks/useOpenNode';
import { landingText } from '../../lib/landing';
import { DAY_MS, flux } from '../../lib/money';
import { DIAL_HORIZONS, HORIZON } from '../../lib/payoutDial';
import { useWalletPrefs } from '../../prefs';
import { Eta } from '../../ui/Eta';
import { Panel } from '../../ui/Panel';
import { PayoutDial } from '../../viz/PayoutDial';

const LIST = 6;
const STEP_MS = 15_000;

export function NextPayouts() {
  const { dto, fleet, globe, landings, money, addr } = useWalletCtx();
  const horizon = useWalletPrefs((s) => s.horizon);
  const setHorizon = useWalletPrefs((s) => s.setHorizon);
  const open = useOpenNode();
  const now = useBoundaryMs(STEP_MS);
  const rowMap = useMemo(() => new Map(fleet.rows.map((r) => [r.key, r])), [fleet.rows]);

  const ahead = useMemo(() => dto.payouts.filter((p) => p.eta_ms >= now), [dto.payouts, now]);
  const list = ahead.slice(0, LIST);
  const day = useMemo(() => {
    const inDay = ahead.filter((p) => p.eta_ms - now < DAY_MS);
    return { count: inDay.length, flux: inDay.reduce((s, p) => s + flux(p.amount), 0) };
  }, [ahead, now]);

  const landKeys = useMemo(() => landings.map((l) => String(l.height)), [landings]);
  const fresh = useFresh(landKeys, { ms: 6_000, max: 3, scope: addr });

  const horizonSpec = HORIZON[horizon];
  const total = dto.payouts.length;

  return (
    <Panel
      title="Next payouts"
      aside={
        total === 0 ? 'nothing queued' : `${formatInt(total)} ${total === 1 ? 'node' : 'nodes'} in the queues`
      }
      actions={
        <SegmentedControl
          size="sm"
          aria-label="Dial horizon"
          value={horizon}
          onChange={setHorizon}
          options={DIAL_HORIZONS.map((h) => ({ value: h, label: HORIZON[h].label }))}
        />
      }
    >
      <div className="wl-payouts">
        <PayoutDial
          payouts={dto.payouts}
          nodes={rowMap}
          landings={landings}
          horizon={horizon}
          scope={addr}
          onNode={globe.hover}
          onOpen={open}
        />

        <div className="wl-payouts__side">
          {landings.length > 0 ? (
            <ul className="wl-landed" aria-label="Payments that landed while this page was open">
              {landings.slice(0, 3).map((l) => (
                <li key={l.height} data-fresh={fresh.has(String(l.height)) || undefined}>
                  <CircleCheck size={15} strokeWidth={1.5} aria-hidden="true" />
                  <span className="wl-landed__text">
                    <b className="ui-mono">{landingText(l)}</b>
                    <i>
                      block {formatInt(l.height)}, <RelativeTime ts={l.at} />
                    </i>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {list.length === 0 ? (
            <p className="wl-note">
              {total === 0
                ? 'No node of this wallet is in a payment queue, so nothing is due. A node joins the queue once it is confirmed.'
                : 'The queue estimates for these nodes are being recomputed.'}
            </p>
          ) : (
            <>
              <h3 className="wl-sub">Coming up</h3>
              <ol className="wl-queue" aria-label="The next payments, soonest first">
                {list.map((p) => {
                  const row = rowMap.get(p.node_key) ?? null;
                  return (
                    <li
                      key={p.node_key}
                      onPointerEnter={() => globe.hover(row)}
                      onPointerLeave={() => globe.hover(null)}
                      onFocus={() => globe.hover(row)}
                      onBlur={() => globe.hover(null)}
                    >
                      <TierGlyph tier={p.tier === 'unknown' ? undefined : p.tier} size={14} />
                      <EntityLink kind="node" value={p.node_key} mono className="wl-queue__node">
                        {row?.endpoint || shortCollateral(p.node_key)}
                      </EntityLink>
                      <span className="wl-queue__amt ui-mono">+{flux(p.amount).toFixed(2)}</span>
                      <Eta at={p.eta_ms} className="wl-queue__eta ui-mono" />
                    </li>
                  );
                })}
              </ol>
              <p className="wl-note">
                In {horizonSpec.phrase.replace('the next ', '')} this wallet expects{' '}
                <b>{formatInt(ahead.filter((p) => p.eta_ms - now < horizonSpec.ms).length)} payments</b>
                {horizon === '24h' ? (
                  <>
                    , about <b>{day.flux.toFixed(2)} FLUX</b>
                    {money.price === null ? '' : ` (${money.text(day.flux)})`}
                  </>
                ) : null}
                . Times are estimates at one block every 30 seconds.
              </p>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
