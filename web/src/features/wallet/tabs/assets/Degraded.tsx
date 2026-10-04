// When the parallel assets cannot be shown. They come from Flux Fusion, an outside service that is down on its own
// schedule; the server answers 503 (with a Retry-After) or 502, and the page keeps working without them. This is a
// designed state, not an error screen: it says what is out, what is unaffected, what Atlas can still tell from the
// wallet's own numbers, and that it is asking again by itself.

import { CloudOff } from 'lucide-react';
import { isApiError } from '../../../../api/http';
import { AnimatedNumber, Button, EmptyState, ErrorState, Skeleton, Stat, StatGrid } from '../../../../ui';
import { isUpstreamDown, retryAfterMs } from '../../api';
import { useWalletCtx } from '../../context';
import { flux, MONTH_DAYS } from '../../lib/money';
import { Panel } from '../../ui/Panel';
import { formatFlux2 } from '../overview/Standing';

export function Degraded() {
  const { assets, dto, money } = useWalletCtx();
  const down = isUpstreamDown(assets.error);
  const perDay = flux(dto.earnings.pa_per_day);
  const secs = Math.round(retryAfterMs(assets.error) / 1000);

  // An address Fusion refuses (a malformed one) is not an outage: the generic state says so and offers no timer.
  if (!down && isApiError(assets.error)) {
    return (
      <Panel title="Parallel assets">
        <ErrorState
          error={assets.error}
          onRetry={() => void assets.refetch()}
          retrying={assets.isFetching}
          framed={false}
          compact
        />
      </Panel>
    );
  }

  return (
    <div className="wl-page wl-assets">
      <Panel title="Parallel assets" icon={CloudOff} aside="Flux Fusion is not answering">
        <EmptyState
          compact
          tone="warn"
          icon={CloudOff}
          title="Parallel assets are not available right now"
          action={
            <Button size="sm" onClick={() => void assets.refetch()} loading={assets.isFetching}>
              Try again
            </Button>
          }
        >
          They are claimed in Flux Fusion, an outside service, and it did not answer. Everything else in this
          wallet is unaffected. Atlas asks again by itself every {secs} seconds while this page is open.
        </EmptyState>
      </Panel>

      {perDay > 0 ? (
        <Panel title="What Atlas can still tell you" aside="from this wallet's own pace, without Fusion">
          <StatGrid min={200}>
            <Stat
              label="Accruing a day"
              value={<AnimatedNumber value={perDay} format={formatFlux2} maxHz={0} />}
              unit="FLUX"
              caption={money.text(perDay)}
            />
            <Stat
              label="Accruing a month"
              value={<AnimatedNumber value={perDay * MONTH_DAYS} format={formatFlux2} maxHz={0} />}
              unit="FLUX"
              caption={money.text(perDay * MONTH_DAYS)}
            />
            <Stat label="Claimable now" caption="needs Fusion" />
          </StatGrid>
          <p className="wl-note">
            Every FLUX a node earns accrues another tenth of itself on each of ten chains, so what is waiting
            in Fusion grows at the same pace as the native rewards. What has been claimed, and what a claim
            would cost, only Fusion knows.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}

export function AssetsSkeleton() {
  return (
    <section className="wl-page wl-assets" aria-busy="true" aria-label="Loading the parallel assets">
      <Panel title="Parallel assets">
        <StatGrid min={200}>
          <Stat label="Mined, all time" loading />
          <Stat label="Claimed so far" loading />
          <Stat label="Claimable now" loading />
        </StatGrid>
        <Skeleton h={16} radius={8} />
      </Panel>
      <Panel title="Chains">
        <ul className="wl-chains" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed set of placeholders
            <li key={i} className="wl-chaincard wl-chaincard--skeleton">
              <Skeleton w="62%" h={14} />
              <Skeleton w="48%" h={22} />
              <Skeleton h={8} radius={4} />
              <Skeleton w="80%" h={10} />
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}
