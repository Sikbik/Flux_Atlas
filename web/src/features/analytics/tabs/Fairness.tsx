// Minting reliability by tier. Proof of Node gives every confirmed node the same odds of being eligible
// to mint a block, whatever its tier, and the first eligible node that is online and synced mints it.
// So a tier's expected share of blocks is its share of the confirmed nodes at the time of each block,
// and a gap between that and what the tier minted measures how reliably its nodes take their turn, not
// a bias in the rule. The headline is the tier furthest from its eligible share, as an observation with
// its 99% range; the likely cause is offered once, labelled a hypothesis.

import { ArrowUp, ExternalLink, Scale } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { formatInt, formatPercent, formatUtcDateTime } from '../../../lib/format';
import {
  Chip,
  EmptyState,
  ErrorState,
  KeyValue,
  Row,
  Section,
  SegmentedControl,
  Skeleton,
  Stack,
  Stat,
  StatGrid,
  StatusChip,
  TierGlyph,
  type TierName,
  tierLabel,
  ViewHeader,
} from '../../../ui';
import { type EligibleSets, useEligibleSets } from '../hooks/useEligibleSets';
import { useProducerSample } from '../hooks/useProducerSample';
import { blocksCovered, expectedByBlock, sumCounts } from '../lib/eligibility';
import { hypothesis, observation } from '../lib/fairnessText';
import type { ProducerTally } from '../lib/producers';
import { chiSquare, chiSquareP, deviation, type FairnessRow, fairness, mostOff, Z } from '../lib/stats';

const TIERS: readonly TierName[] = ['stratus', 'nimbus', 'cumulus'];

const SIZES = [
  { value: '1000', label: '1,000 blocks' },
  { value: '3000', label: '3,000 blocks' },
  { value: '10000', label: '10,000 blocks' },
] as const;

/** fluxd at the commit the rule was read from; the research notes cite the same files. */
const FLUXD = 'https://github.com/RunOnFlux/fluxd/blob/8a60ee6316371a120ae8546c8d42f4cb3bc71158/src/pon';

const pct = (f: number) => formatPercent(f, 1);
/** `-0.068` as `-6.8` (the caller adds the percent sign). */
const signedNumber = (f: number) => `${f < 0 ? '-' : '+'}${(Math.abs(f) * 100).toFixed(1)}`;
const signed = (f: number) => `${signedNumber(f)}%`;

interface Model {
  rows: FairnessRow[];
  chi2: number;
  df: number;
  p: number;
  /** The tier furthest from its eligible share, when any is outside the range. */
  headline: FairnessRow | null;
  scaleMax: number;
  /** Blocks compared: those with a producer whose tier is known. */
  known: number;
  /** Blocks whose producer left the network or is unknown, left out. */
  unknown: number;
  total: number;
  /** Blocks at or after the earliest recorded set; older ones are judged by that set. */
  covered: number;
  sets: EligibleSets;
}

function buildModel(tally: ProducerTally, sets: EligibleSets): Model | null {
  if (tally.known === 0) return null;
  if (sumCounts(sets.fallback) === 0 && sets.samples.length === 0) return null;
  const e = expectedByBlock(tally.knownTimes, sets.samples, sets.fallback);
  const inputs = TIERS.map((tier) => ({
    key: tier,
    label: tierLabel(tier),
    nodes: sets.fallback[tier],
    produced: tally.counts[tier],
    expectedBlocks: e.expected[tier],
    variance: e.variance[tier],
  }));
  const nodes = sumCounts(sets.fallback);
  // One level for the line and the flag: a tier is flagged exactly when its expected share is outside
  // the 99% range, and with three tiers 99% keeps luck from flagging one in twenty.
  const rows = fairness(inputs, nodes, tally.known, { ciZ: Z[99], flagZ: Z[99] });
  const { chi2, df } = chiSquare(inputs, nodes, tally.known);
  return {
    rows,
    chi2,
    df,
    p: chiSquareP(chi2, df),
    headline: mostOff(rows),
    scaleMax: Math.min(1, Math.max(...rows.map((r) => Math.max(r.hi, r.nodeShare))) * 1.12),
    known: tally.known,
    unknown: tally.unknown,
    total: tally.total,
    covered: blocksCovered(tally.knownTimes, sets.samples),
    sets,
  };
}

/** The last model that was ready, so a change of sample size dims the figures instead of blanking them. */
function useLast<T>(value: T | null): T | null {
  const last = useRef<T | null>(null);
  if (value !== null) last.current = value;
  return value ?? last.current;
}

function Source() {
  return (
    <span className="an-source">
      Source: fluxd{' '}
      <a href={`${FLUXD}/pon.cpp`} target="_blank" rel="noopener noreferrer">
        pon.cpp
        <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
      </a>{' '}
      and{' '}
      <a href={`${FLUXD}/pon-minter.cpp`} target="_blank" rel="noopener noreferrer">
        pon-minter.cpp
        <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
      </a>
      .
    </span>
  );
}

function FairnessSkeleton({ progress }: { progress?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label="Sampling blocks">
      <ViewHeader level={2} kind="Fairness" icon={Scale} title="Minting reliability by tier">
        {progress ? <Chip mono>{progress}</Chip> : null}
      </ViewHeader>
      <div className="ex-hero">
        <StatGrid min={220}>
          <Stat hero label="Against the eligible share" loading />
        </StatGrid>
      </div>
      <Section title="Blocks minted by tier">
        <Stack gap={6}>
          {TIERS.map((t) => (
            <Skeleton key={t} h={56} radius={10} />
          ))}
        </Stack>
      </Section>
    </div>
  );
}

/** One row per tier: the share of blocks it minted (the dot), its 99% range (the line) and its eligible share (the tick). */
function Rows({ model }: { model: Model }) {
  return (
    <>
      <ul className="an-fairs" aria-label="Share of blocks minted by tier against eligible share">
        {model.rows.map((r) => {
          const at = (v: number) => `${Math.min(100, (v / model.scaleMax) * 100)}%`;
          return (
            <li key={r.key} className="an-fair" data-tier={r.key} data-verdict={r.verdict}>
              <div className="an-fair__head">
                <span className="an-fair__tier">
                  <TierGlyph tier={r.key as TierName} size={16} />
                  {r.label}
                </span>
                <span className="an-fair__nums">
                  <strong className="ui-mono">{pct(r.producedShare)}</strong> of blocks
                  <span> eligible share {pct(r.nodeShare)}</span>
                </span>
                {r.verdict === 'within' ? (
                  <StatusChip status="confirmed" label="As expected" size="sm" />
                ) : r.verdict === 'above' ? (
                  <Chip size="sm" tone="accent" icon={ArrowUp}>
                    Mints more than its share
                  </Chip>
                ) : (
                  <StatusChip status="at-risk" label="Mints less than its share" size="sm" />
                )}
              </div>
              <div
                className="an-fair__plot"
                role="img"
                aria-label={`${r.label}: ${pct(r.producedShare)} of ${formatInt(model.known)} blocks, eligible share ${pct(r.nodeShare)}, 99% range ${pct(r.lo)} to ${pct(r.hi)}`}
                title={`${formatInt(r.produced)} of ${formatInt(model.known)} blocks; about ${formatInt(Math.round(r.expected))} expected. 99% range ${pct(r.lo)} to ${pct(r.hi)}.`}
              >
                <span
                  className="an-fair__whisker"
                  style={{ left: at(r.lo), width: `calc(${at(r.hi)} - ${at(r.lo)})` }}
                />
                <span className="an-fair__expected" style={{ left: at(r.nodeShare) }} />
                <span className="an-fair__dot" style={{ left: at(r.producedShare) }} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="an-fair__scale" aria-hidden="true">
        <span>0%</span>
        <span>{pct(model.scaleMax / 2)}</span>
        <span>{pct(model.scaleMax)}</span>
      </div>
      <p className="ex-caption">
        The dot is the share of blocks the tier minted and the line its 99% range; the white tick is its
        eligible share, its part of the confirmed nodes.
      </p>
    </>
  );
}

function Method({ model }: { model: Model }) {
  const { sets } = model;
  const fb = sets.fallback;
  return (
    <KeyValue
      align="start"
      items={[
        {
          label: 'Sample',
          value: (
            <>
              The newest {formatInt(model.total)} blocks. {formatInt(model.known)} were minted by a node still
              on the network and are compared; the other {formatInt(model.unknown)} (
              {pct(model.total > 0 ? model.unknown / model.total : 0)}) are left out.
            </>
          ),
        },
        {
          label: 'Eligible share',
          value: (
            <>
              {sets.samples.length > 0 && sets.recordedFromMs !== null ? (
                <>
                  For each block, a tier's chance is its confirmed nodes over all confirmed nodes at that
                  time, read from the server's recorded timeline at {formatInt(sets.samples.length)} moments
                  across the sample. The record begins {formatUtcDateTime(sets.recordedFromMs)} and covers{' '}
                  {formatInt(model.covered)} of the {formatInt(model.known)} blocks; older blocks use the set
                  from that moment.
                </>
              ) : (
                <>
                  The server has no recorded history to read yet, so today's confirmed nodes (
                  {formatInt(fb.cumulus)} Cumulus, {formatInt(fb.nimbus)} Nimbus, {formatInt(fb.stratus)}{' '}
                  Stratus) stand in for the whole sample.
                </>
              )}{' '}
              Started, offline, expired and DoS nodes do not count.
            </>
          ),
        },
        {
          label: 'Range',
          value: `The line on a row is the 99% Wilson interval of the share a tier minted. A tier is flagged when its block count is more than ${Z[99].toFixed(2)} standard deviations from the expected count; with three tiers, one can sit outside a 95% range by luck alone.`,
        },
        {
          label: 'All tiers together',
          value: `chi-square ${model.chi2.toFixed(2)} on ${model.df} degrees of freedom, ${
            model.p < 0.01 ? 'p < 0.01' : `p = ${model.p.toFixed(2)}`
          }`,
          mono: true,
        },
      ]}
    />
  );
}

export function FairnessTab() {
  const [size, setSize] = useState<'1000' | '3000' | '10000'>('3000');
  const sample = useProducerSample(Number(size));
  const { tally } = sample;

  const span = useMemo(() => {
    if (tally.knownTimes.length === 0) return null;
    return { from: Math.min(...tally.knownTimes), to: Math.max(...tally.knownTimes) };
  }, [tally.knownTimes]);
  const sets = useEligibleSets(sample.done && span ? span.from : null, sample.done && span ? span.to : null);

  const ready = sample.done && sets.ready;
  const fresh = useMemo(() => (ready ? buildModel(tally, sets) : null), [ready, tally, sets]);
  const model = useLast(fresh);
  const stale = model !== null && fresh === null;

  if (sample.error && tally.known === 0) {
    return <ErrorState error={sample.error} title="Could not load recent blocks" />;
  }
  if (!model) {
    if (ready) {
      return (
        <EmptyState icon={Scale} title="No block producers are known yet">
          The explorer has not matched recent blocks to nodes. Check back in a moment.
        </EmptyState>
      );
    }
    return (
      <FairnessSkeleton
        progress={
          sample.done
            ? undefined
            : `sampling ${formatInt(sample.loaded)} of ${formatInt(sample.target)} blocks`
        }
      />
    );
  }

  const { rows, headline } = model;
  const dev = headline ? deviation(headline) : null;
  const note = observation(rows);
  const cause = hypothesis(rows);

  return (
    <div className="an-fairness" data-stale={stale || undefined} aria-busy={stale || undefined}>
      <ViewHeader
        level={2}
        kind="Fairness"
        icon={Scale}
        title="Minting reliability by tier"
        subtitle={note || 'Every tier minted about as many blocks as its eligible share predicts.'}
        freshness={
          stale ? (
            <Chip mono role="status">
              {sample.done
                ? 'reading node sets'
                : `sampling ${formatInt(sample.loaded)} of ${formatInt(sample.target)} blocks`}
            </Chip>
          ) : undefined
        }
      >
        {headline && dev ? (
          <Chip mono title="The range of the share the tier minted, as a difference from its eligible share">
            {headline.label} 99% range {signed(dev.lo)} to {signed(dev.hi)}
          </Chip>
        ) : null}
        <Chip mono>{formatInt(model.known)} blocks compared</Chip>
      </ViewHeader>

      <div className="ex-hero">
        <StatGrid min={220}>
          {headline && dev ? (
            <Stat
              hero
              tier={headline.key as TierName}
              label={`${headline.label} blocks against its eligible share`}
              value={signedNumber(dev.rel)}
              unit="%"
              caption={`over ${formatInt(model.known)} blocks`}
            />
          ) : (
            <Stat
              hero
              label="Every tier against its eligible share"
              value="In range"
              caption={`over ${formatInt(model.known)} blocks`}
            />
          )}
        </StatGrid>
      </div>

      <Section title="Blocks minted by tier">
        <Stack gap={5}>
          <Row>
            <SegmentedControl
              size="sm"
              aria-label="Sample size"
              options={SIZES}
              value={size}
              onChange={setSize}
            />
          </Row>
          <Rows model={model} />
        </Stack>
      </Section>

      <Section title="How blocks are chosen">
        <p className="an-rule">
          Every 30 seconds each confirmed node gets the same odds of being eligible to mint, whatever its tier
          or collateral. The eligible nodes are ranked, and each waits four seconds longer than the one before
          it; the first that is online and synced mints the block.
        </p>
        <p className="an-rule">
          With equal odds, a tier's eligible share is its share of the confirmed nodes. <Source />
        </p>
        {cause ? (
          <p className="an-rule an-hypothesis">
            <b>Hypothesis.</b> {cause}
          </p>
        ) : null}
      </Section>

      <Section title="How this is tested" collapsible defaultOpen={false}>
        <Method model={model} />
      </Section>
    </div>
  );
}
