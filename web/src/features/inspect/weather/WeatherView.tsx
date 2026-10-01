import { useNavigate } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { formatPercent } from '../../../lib/format';
import { ErrorState, KeyValue, Section } from '../../../ui';
import { CHECKIN } from '../derive/expiry';
import { THRESHOLDS } from '../derive/weather';
import { useWeather } from '../sources/weather';
import { useOpenSet } from '../ui/openset';
import '../ui/parts.css';
import { Haze } from './Haze';
import { WeatherHead, WeatherStats } from './Head';
import { WeatherWhere } from './Where';
import './weather.css';

const pct = (r: number) => formatPercent(r, r < 0.1 ? 1 : 0);

/** Where each figure comes from, in plain words, and what moves the verdict. */
function Measured({ open }: { open: ReturnType<typeof useOpenSet> }) {
  const u = THRESHOLDS.unsettled;
  const s = THRESHOLDS.storm;
  return (
    <Section
      collapsible
      level={3}
      icon={Info}
      title="How this is measured"
      open={open.isOpen('measured')}
      onOpenChange={(v) => open.setOpen('measured', v)}
    >
      <KeyValue
        align="start"
        ruled
        items={[
          {
            label: 'Unreachable',
            value:
              "Nodes whose API port the server's sweeps could not reach. Read from the node list, then kept current by the live stream.",
          },
          {
            label: 'At risk',
            value: `Worked out here: a node with ${CHECKIN.atRisk} or more blocks since its last check-in (it expires at ${CHECKIN.expire}).`,
          },
          {
            label: 'DoS listed',
            value: "Nodes on the network's DoS list, straight from the live node table.",
          },
          {
            label: 'Benchmarks',
            value:
              'The node list carries no benchmark results, so failures are shown as Unknown rather than guessed.',
          },
          {
            label: 'Verdict',
            value: `Unsettled from ${pct(u.unreachable)} unreachable, ${pct(u.atRisk)} at risk or ${pct(u.dos)} DoS listed. A storm from ${pct(s.unreachable)}, ${pct(s.atRisk)} or ${pct(s.dos)}.`,
          },
        ]}
      />
    </Section>
  );
}

/**
 * Network weather: whether the network is well, and where it is not. A panel over the globe leads with a
 * verdict and the four counts behind it; a list says where the trouble concentrates, and glows on the globe
 * mark the same places. Unreachable nodes and check-in ages come from the server's node list (read once);
 * the live table lays its changes over it, so the numbers move with the stream without any polling.
 */
export function WeatherView() {
  const w = useWeather();
  const open = useOpenSet('weather');
  const navigate = useNavigate();
  const close = useCallback(() => {
    void navigate({ to: '/', search: ((prev: Record<string, unknown>) => prev) as never });
  }, [navigate]);

  // Escape closes the layer, as it does a window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (el?.closest('input, textarea, select, [role="dialog"], [role="listbox"], [role="menu"]')) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <article className="ix ix-weather" aria-label="Network weather" data-level={w.verdict.level}>
      <WeatherHead w={w} onClose={close} />
      <WeatherStats w={w} />
      {w.failed ? (
        <div className="ix-pad">
          <ErrorState title="The node list could not be read" onRetry={w.retry}>
            Unreachable nodes and check-in ages come from it. The DoS count above is still live.
          </ErrorState>
        </div>
      ) : (
        <WeatherWhere w={w} />
      )}
      <Measured open={open} />
      <Haze spots={w.partial ? [] : w.hotspots} />
    </article>
  );
}
