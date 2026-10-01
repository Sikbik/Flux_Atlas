// Chain: how hard blocks are to produce and how evenly they arrive. The answer is four numbers (the blocks
// in the window, the latest height, the average block time against its target, the latest difficulty) and
// two charts of one window that share a crosshair: difficulty, and the time between blocks with the
// target drawn as the step it is. A server that is still reading the chain's past says so in one calm
// line and the charts draw what is there.

import { Blocks, History } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isApiError } from '../../../api/http';
import { formatInt } from '../../../lib/format';
import {
  AnimatedNumber,
  Card,
  Delta,
  EmptyState,
  Freshness,
  Meter,
  QueryBoundary,
  Section,
  SegmentedControl,
  Skeleton,
  Stack,
  Stat,
  ViewHeader,
} from '../../../ui';
import { CHAIN_REFRESH_MS, useChainHistory } from '../hooks/useChainHistory';
import {
  CHAIN_WINDOWS,
  chainModel,
  difficultyChange,
  formatDifficulty,
  indexingPercent,
  indexingText,
  paceVsTarget,
  WINDOW_TEXT,
} from '../lib/chain';
import type { ChainCoverageDto, ChainHistoryDto, ChainWindow } from '../lib/chainTypes';
import { BlockTimeChart } from '../viz/BlockTimeChart';
import { DifficultyChart } from '../viz/DifficultyChart';

const OPTIONS = CHAIN_WINDOWS.map((value) => ({ value, label: WINDOW_TEXT[value].short }));
/** The plot height of both charts, axes included. */
const CHART_HEIGHT = 232;

function WindowControl({ value, onChange }: { value: ChainWindow; onChange: (w: ChainWindow) => void }) {
  return (
    <SegmentedControl
      size="sm"
      aria-label="Time window"
      options={OPTIONS}
      value={value}
      onChange={onChange}
    />
  );
}

/** One calm line, and a thin meter: the server is still reading the chain's past. */
function IndexingNote({ coverage }: { coverage: ChainCoverageDto }) {
  const percent = indexingPercent(coverage) ?? 0;
  return (
    <Card tone="flat" padding="md" className="an-chain-note">
      <Stack gap={4}>
        <p className="an-chain-note__text">
          <History size={14} strokeWidth={1.5} aria-hidden="true" />
          <strong>{indexingText(coverage)}</strong>
          <span>Older blocks fill in as the server reads them.</span>
        </p>
        <Meter label="Indexing chain history" value={percent / 100} />
      </Stack>
    </Card>
  );
}

function ChainSkeleton() {
  return (
    <div className="an-chain-body" aria-hidden="true">
      <div className="ex-hero">
        <div className="an-chain-tiles">
          <Stat loading label="Blocks in the window" />
          <Stat loading label="Latest height" />
          <Stat loading label="Average block time" />
          <Stat loading label="Latest difficulty" />
        </div>
      </div>
      <div className="an-chain-charts">
        <Section title="Difficulty">
          <Skeleton h={CHART_HEIGHT + 32} radius={12} />
        </Section>
        <Section title="Time per block">
          <Skeleton h={CHART_HEIGHT + 32} radius={12} />
        </Section>
      </div>
    </div>
  );
}

function ChainBody({ dto, asked, stale }: { dto: ChainHistoryDto; asked: ChainWindow; stale: boolean }) {
  const model = useMemo(() => chainModel(dto, asked), [dto, asked]);
  // The bucket under the crosshair of either chart: reading one moves the other.
  const [cursor, setCursor] = useState<number | null>(null);
  const text = WINDOW_TEXT[model.window];
  const indexing = indexingText(dto.coverage) !== null;
  const pace = paceVsTarget(dto.avg_block_time_s, model.story.expected);
  // Across a change of rules (Proof of Node) difficulty is a different quantity, so there is no change to quote.
  const change = model.changes.length > 0 ? null : difficultyChange(model.frame.difficulty);
  const empty = model.frame.t.length === 0;

  return (
    <div className="an-chain-body" data-stale={stale || undefined} aria-busy={stale || undefined}>
      {indexing ? (
        <div className="ex-hero">
          <IndexingNote coverage={dto.coverage} />
        </div>
      ) : null}

      <div className="ex-hero">
        <div className="an-chain-tiles">
          <Stat
            label={text.blocks}
            value={formatInt(dto.block_count)}
            caption={
              dto.block_count > 0
                ? `${formatInt(dto.from_height)} to ${formatInt(dto.to_height)}${indexing ? ', still indexing' : ''}`
                : indexing
                  ? 'Nothing indexed yet'
                  : 'None recorded'
            }
          />
          <Stat
            label="Latest height"
            value={<AnimatedNumber value={dto.latest_height} />}
            caption={dto.block_count > 0 ? 'Newest block in this history' : 'The chain tip'}
          />
          <Stat
            label="Average block time"
            value={dto.avg_block_time_s === null ? null : dto.avg_block_time_s.toFixed(1)}
            unit="s"
            delta={
              pace === null ? undefined : (
                <Delta kind="percent" decimals={1} value={pace} period="vs target" />
              )
            }
            caption={model.story.text || undefined}
          />
          <Stat
            label="Latest difficulty"
            value={dto.latest_difficulty === null ? null : formatDifficulty(dto.latest_difficulty)}
            delta={
              change === null ? undefined : (
                <Delta kind="percent" decimals={1} value={change} period={text.period} />
              )
            }
            caption="At the newest block"
          />
        </div>
      </div>

      {empty ? (
        <Section title="History">
          <EmptyState compact icon={Blocks} title="No blocks recorded for this window yet">
            {indexing
              ? 'The server is still reading the chain. The charts draw as soon as blocks are indexed.'
              : 'Pick a longer window, or check back after the next block.'}
          </EmptyState>
        </Section>
      ) : (
        <div className="an-chain-charts">
          <Section title="Difficulty">
            <DifficultyChart model={model} cursor={cursor} onCursor={setCursor} height={CHART_HEIGHT} />
          </Section>
          <Section title="Time per block">
            <BlockTimeChart model={model} cursor={cursor} onCursor={setCursor} height={CHART_HEIGHT} />
          </Section>
        </div>
      )}
    </div>
  );
}

export function ChainTab() {
  const [win, setWin] = useState<ChainWindow>('7d');
  const q = useChainHistory(win);
  const noHistory = isApiError(q.error) && q.error.code === 'no_history' && q.data === undefined;

  return (
    <div className="an-chain">
      <ViewHeader
        level={2}
        kind="Chain"
        icon={Blocks}
        title="Block difficulty and timing"
        subtitle={`How hard blocks are to produce and how evenly they arrive, over ${WINDOW_TEXT[win].phrase}.`}
        freshness={
          <Freshness label="chain history" ts={q.dataUpdatedAt || null} cadenceMs={CHAIN_REFRESH_MS[win]} />
        }
        actions={<WindowControl value={win} onChange={setWin} />}
      />
      {noHistory ? (
        <Section>
          <EmptyState icon={History} title="No chain history yet">
            The server has not recorded the chain's blocks. Check back in a few minutes.
          </EmptyState>
        </Section>
      ) : (
        <QueryBoundary query={q} skeleton={<ChainSkeleton />}>
          {(dto) => <ChainBody dto={dto} asked={win} stale={q.isPlaceholderData} />}
        </QueryBoundary>
      )}
    </div>
  );
}
