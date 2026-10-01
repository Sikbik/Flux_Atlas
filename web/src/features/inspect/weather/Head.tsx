import { CloudSun, RotateCw, X } from 'lucide-react';
import { formatInt, formatPercent } from '../../../lib/format';
import {
  AnimatedNumber,
  Button,
  Freshness,
  IconButton,
  LiveDot,
  Section,
  Stat,
  StatGrid,
  type StatusTone,
  ViewHeader,
} from '../../../ui';
import { CHECKIN } from '../derive/expiry';
import type { WeatherLevel } from '../derive/weather';
import { SCAN_CADENCE_MS, type WeatherData } from '../sources/weather';

const WORD: Record<WeatherLevel, string> = {
  healthy: 'Healthy',
  unsettled: 'Unsettled',
  storm: 'Storm',
  unknown: 'Waiting for the network',
};

const TONE: Record<WeatherLevel, StatusTone> = {
  healthy: 'ok',
  unsettled: 'warn',
  storm: 'crit',
  unknown: 'pending',
};

/** The verdict as the header says it: a word, and the one line of numbers behind it. */
function say(w: WeatherData): { word: string; tone: StatusTone; line: string } {
  if (w.failed) {
    return {
      word: 'Node list unavailable',
      tone: 'off',
      line: 'Only the changes seen since you opened Atlas can be counted.',
    };
  }
  if (w.scanning) {
    return {
      word: 'Reading the node list',
      tone: 'pending',
      line: 'The totals appear when it has been read.',
    };
  }
  const level = w.verdict.level;
  const c = w.counts;
  const figures = `${formatInt(c.unreachable)} unreachable, ${formatInt(c.atRisk)} at risk${c.dos > 0 ? `, ${formatInt(c.dos)} DoS` : ''}`;
  // A calm day gives the figures; a troubled one says what tipped it (the tiles below hold the figures).
  const why = w.verdict.reasons.join(', ');
  return { word: WORD[level], tone: TONE[level], line: why || figures };
}

export function WeatherHead({ w, onClose }: { w: WeatherData; onClose: () => void }) {
  const { word, tone, line } = say(w);
  return (
    <ViewHeader
      kind="Network"
      icon={CloudSun}
      title={
        <span className="ix-verdict" data-level={w.failed ? 'unknown' : w.verdict.level}>
          <LiveDot status={tone} ping={false} size={9} />
          {word}
        </span>
      }
      subtitle={line || undefined}
      freshness={
        <span className="ix-head-aside">
          {w.scannedAt === null ? null : (
            <Freshness ts={w.scannedAt} cadenceMs={SCAN_CADENCE_MS} label="node list" />
          )}
          <IconButton size="sm" variant="ghost" icon={X} label="Close the weather" onClick={onClose} />
        </span>
      }
      actions={
        w.failed ? (
          <Button size="sm" variant="secondary" icon={RotateCw} onClick={w.retry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}

const share = (n: number, total: number) =>
  total > 0 ? formatPercent(n / total, n / total < 0.1 ? 1 : 0) : null;

/**
 * The four numbers behind the verdict. Unreachable and at risk need the node list, so until it has been
 * read they are skeletons (and Unknown if it cannot be); DoS comes straight from the live table.
 */
export function WeatherStats({ w }: { w: WeatherData }) {
  const c = w.counts;
  const known = !w.partial;
  const wait = w.scanning;
  const of = `of ${formatInt(c.total)} nodes`;
  return (
    <Section>
      <StatGrid min={150}>
        <Stat
          label="Unreachable"
          loading={wait}
          value={known ? <AnimatedNumber value={c.unreachable} /> : null}
          caption={known ? `${share(c.unreachable, c.total) ?? ''} ${of}`.trim() : undefined}
        />
        <Stat
          label="At risk"
          loading={wait}
          value={known ? <AnimatedNumber value={c.atRisk} /> : null}
          caption={
            known ? (
              <span
                title={`${CHECKIN.atRisk} or more blocks since the last check-in (it expires at ${CHECKIN.expire})`}
              >
                overdue check-in
              </span>
            ) : undefined
          }
        />
        <Stat
          label="DoS listed"
          value={<AnimatedNumber value={c.dos} />}
          caption={c.total > 0 ? `${share(c.dos, c.total) ?? ''} ${of}`.trim() : undefined}
        />
        <Stat label="Benchmark failures" value={null} caption="not in the node list" />
      </StatGrid>
    </Section>
  );
}
