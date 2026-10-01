// Fairness: does block production favour a tier? If every node has the same chance to produce a
// block, each tier should produce about its share of nodes. The headline is whether every tier sits
// inside the range chance allows; the instrument shows, per tier, the expected share, the observed
// share and the interval around it. A tier is flagged only beyond 99% confidence, because with three
// tiers one can land outside a 95% interval by luck alone.

import { Scale } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSummary } from '../../../app/context';
import { formatInt, formatPercent } from '../../../lib/format';
import {
  EntityHead,
  ErrorState,
  HeroNumber,
  Section,
  Segmented,
  type SegmentedItem,
  Skeleton,
  StatusChip,
  TIER_LABEL,
  TierGlyph,
  type TierName,
} from '../../explorer/parts';
import { useProducerSample } from '../hooks/useProducerSample';
import { chiSquare, chiSquareP, fairness, Z } from '../lib/stats';

const TIERS: readonly TierName[] = ['stratus', 'nimbus', 'cumulus'];

const SIZES: readonly SegmentedItem<string>[] = [
  { id: '1000', label: '1,000 blocks', hint: 'About 8 hours' },
  { id: '3000', label: '3,000 blocks', hint: 'About a day' },
  { id: '10000', label: '10,000 blocks', hint: 'About 3.5 days' },
];

const pct = (f: number) => formatPercent(f, 1);

export function FairnessTab() {
  const [size, setSize] = useState('3000');
  const target = Number(size);
  const sample = useProducerSample(target);
  const summary = useSummary();
  const { tally } = sample;

  const model = useMemo(() => {
    if (!summary || tally.known === 0) return null;
    const inputs = TIERS.map((tier) => ({
      key: tier,
      label: TIER_LABEL[tier],
      nodes: summary.tiers[tier],
      produced: tally.counts[tier],
    }));
    const nodes = inputs.reduce((s, r) => s + r.nodes, 0);
    const rows = fairness(inputs, nodes, tally.known);
    const { chi2, df } = chiSquare(inputs, nodes, tally.known);
    const scaleMax = Math.min(1, Math.max(...rows.map((r) => Math.max(r.hi, r.nodeShare))) * 1.12);
    return {
      rows,
      chi2,
      df,
      p: chiSquareP(chi2, df),
      flagged: rows.filter((r) => r.verdict !== 'within'),
      scaleMax,
    };
  }, [summary, tally]);

  if (sample.error && tally.known === 0) {
    return <ErrorState title="Could not load recent blocks" />;
  }
  if (!model) {
    return (
      <div role="status" aria-busy="true" aria-label="Sampling blocks">
        <EntityHead kind="Fairness" icon={Scale} title={<Skeleton w={260} h={46} radius={8} />} loading />
        <Section>
          <Skeleton h={220} radius={14} />
        </Section>
      </div>
    );
  }
  const { rows, flagged } = model;
  const fair = flagged.length === 0;
  const direction = (v: string) => (v === 'above' ? 'more' : 'fewer');

  return (
    <>
      <EntityHead
        kind="Fairness"
        icon={Scale}
        status={fair ? 'ok' : 'warn'}
        aside={
          sample.done ? undefined : (
            <span className="ex-mono ex-muted" role="status">
              sampling {formatInt(sample.loaded)} of {formatInt(sample.target)} blocks
            </span>
          )
        }
        title={
          <HeroNumber
            whole={fair ? 'In range' : `${flagged.length} of ${rows.length} out of range`}
            unit={`over ${formatInt(tally.known)} blocks`}
          />
        }
        sub={
          <span>
            {fair
              ? 'Every tier produced about as many blocks as its share of nodes predicts.'
              : `${flagged.map((f) => `${f.label} produced ${direction(f.verdict)} blocks`).join(', ')} than chance explains at 99% confidence.`}
          </span>
        }
      />

      <Section
        title="Blocks produced by tier"
        aside="against what chance predicts"
        actions={<Segmented items={SIZES} value={size} onChange={setSize} label="Sample size" />}
      >
        <ul className="an-fairs" aria-label="Producer share by tier against node share">
          {rows.map((r) => {
            const at = (v: number) => `${Math.min(100, (v / model.scaleMax) * 100)}%`;
            return (
              <li key={r.key} className="an-fair" data-tier={r.key} data-verdict={r.verdict}>
                <div className="an-fair__head">
                  <span className="an-fair__tier">
                    <TierGlyph tier={r.key as TierName} size={16} />
                    {r.label}
                  </span>
                  <span className="an-fair__nums">
                    <strong className="ex-mono">{pct(r.producedShare)}</strong> of blocks
                    <span> expected {pct(r.nodeShare)}</span>
                  </span>
                  <StatusChip
                    status={r.verdict === 'within' ? 'ok' : 'warn'}
                    label={
                      r.verdict === 'within'
                        ? 'In range'
                        : r.verdict === 'above'
                          ? 'Above range'
                          : 'Below range'
                    }
                    size="sm"
                  />
                </div>
                <div
                  className="an-fair__plot"
                  role="img"
                  aria-label={`${r.label}: ${pct(r.producedShare)} of ${formatInt(tally.known)} blocks, expected ${pct(r.nodeShare)}, 95% range ${pct(r.lo)} to ${pct(r.hi)}`}
                  title={`${formatInt(r.produced)} blocks of ${formatInt(tally.known)}. 95% range ${pct(r.lo)} to ${pct(r.hi)}.`}
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
        <p className="an-note">
          The dot is the observed share and the line its 95% range; the white tick is the share of nodes,
          which is what chance predicts.
          {tally.unknown > 0
            ? ` ${formatInt(tally.unknown)} blocks made by nodes that have since left the network are left out.`
            : ''}
        </p>
      </Section>

      <Section title="How this is tested" collapsible defaultOpen={false}>
        <dl className="an-facts">
          <div>
            <dt>Sample</dt>
            <dd>
              The newest {formatInt(tally.total)} blocks, of which {formatInt(tally.known)} were produced by a
              node still on the network and are compared.
            </dd>
          </div>
          <div>
            <dt>Expected</dt>
            <dd>
              The test assumes every node has the same chance to produce, so a tier should produce its share
              of nodes. If the real selection weights nodes differently, a flag shows the rule is not uniform,
              not that anything is broken.
            </dd>
          </div>
          <div>
            <dt>Range</dt>
            <dd>
              Wilson interval at 95% for the observed share. A tier is flagged only beyond 99% (z = {Z[99]}).
            </dd>
          </div>
          <div>
            <dt>All tiers together</dt>
            <dd className="ex-mono">
              chi-square {model.chi2.toFixed(2)} on {model.df} degrees of freedom, p = {model.p.toFixed(2)}
            </dd>
          </div>
        </dl>
      </Section>
    </>
  );
}
