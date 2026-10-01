// The chip at the top of the globe that says what is on screen: "Archive view, 4 d 11 h ago, 6,512
// nodes, block 2,978,201", or, before anything has been scrubbed, how to start. It also owns the honest
// details: what the recording holds for that moment and what it does not.

import { History, Info, TriangleAlert } from 'lucide-react';
import { formatInt } from '../../../lib/format';
import { Button, IconButton, KeyValue, type KeyValueItem, Popover, Stack } from '../../../ui';
import { useThrottledT } from '../hooks/useThrottledT';
import type { TimeMachine, TmState } from '../lib/controller';
import { type Curve, readingAt } from '../lib/curve';
import type { ArchiveInfo } from '../lib/summary';
import { ageShort, formatInstantMinutes, formatInstantSeconds } from '../lib/time';

export interface ArchiveChipProps {
  tm: TimeMachine;
  state: TmState;
  now: number;
  curve: Curve | null;
  /** The first instant on record, for the hint. */
  start: number | null;
  /** The server's first whole network state (`/timeline` `first_ms`), for "No data before". */
  first?: number | null;
  /** Enough history to scrub. */
  ready: boolean;
  /** The hint has done its job; show it only until the first move. */
  hintDone: boolean;
}

export function ArchiveChip({ tm, state, now, curve, start, first, ready, hintDone }: ArchiveChipProps) {
  const t = useThrottledT(tm, 200);
  const archive = state.mode === 'archive';
  const mode =
    state.noHistory !== null && archive
      ? 'nodata'
      : state.error && archive
        ? 'error'
        : archive
          ? 'archive'
          : hintDone || !ready
            ? 'off'
            : 'hint';
  // Before the first keyframe there is nothing to rebuild; past it, too little was recorded nearby.
  const missed = state.noHistory;
  const bound = first ?? start;
  const before = missed !== null && bound !== null && missed < bound;
  const reading = archive && curve ? readingAt(curve, t) : null;
  const info = state.info;
  const nodes = info?.nodes ?? reading?.nodes ?? null;
  return (
    <div className="tm-chip" data-mode={mode} inert={mode === 'off' || undefined}>
      {mode === 'archive' ? (
        <>
          <span className="tm-chip__row">
            <History className="tm-chip__icon" size={15} strokeWidth={1.5} aria-hidden="true" />
            <strong className="tm-chip__title">Archive view</strong>
            <span className="tm-chip__fact">{ageShort(now - t)} ago</span>
          </span>
          <span className="tm-chip__row">
            <span className="tm-chip__fact tabular">
              {nodes === null ? (state.loading ? 'loading' : 'nodes unknown') : `${formatInt(nodes)} nodes`}
            </span>
            {reading?.tip != null ? (
              <span className="tm-chip__fact tabular">block {formatInt(reading.tip)}</span>
            ) : null}
            {info ? <Facts info={info} /> : null}
          </span>
        </>
      ) : null}
      {mode === 'nodata' && missed !== null ? (
        <>
          <span className="tm-chip__row">
            <History className="tm-chip__icon" size={15} strokeWidth={1.5} aria-hidden="true" />
            <strong className="tm-chip__title" role="status">
              {before && bound !== null
                ? `No data before ${formatInstantMinutes(bound)}`
                : `No data for ${formatInstantMinutes(missed)}`}
            </strong>
          </span>
          <span className="tm-chip__row">
            <span className="tm-chip__fact">
              {before
                ? 'The recording starts there.'
                : 'Too little was recorded around this moment to rebuild the network.'}
            </span>
            {start !== null ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => tm.settle(Math.max(start, bound ?? start))}
              >
                Go to the start
              </Button>
            ) : null}
          </span>
        </>
      ) : null}
      {mode === 'error' ? (
        <>
          <TriangleAlert className="tm-chip__icon" size={15} strokeWidth={1.5} aria-hidden="true" />
          <span className="tm-chip__fact">This moment could not be loaded.</span>
          <Button size="sm" variant="secondary" onClick={() => tm.retry()}>
            Try again
          </Button>
        </>
      ) : null}
      {mode === 'hint' ? (
        <>
          <span className="tm-chip__row">
            <History className="tm-chip__icon" size={15} strokeWidth={1.5} aria-hidden="true" />
            <strong className="tm-chip__title">Time machine</strong>
          </span>
          <span className="tm-chip__row">
            <span className="tm-chip__fact">
              Drag the handle back{start === null ? '' : `, history since ${formatInstantMinutes(start)}`}
            </span>
          </span>
        </>
      ) : null}
    </div>
  );
}

/** What the recording holds for the moment on screen, and what it does not. */
function Facts({ info }: { info: ArchiveInfo }) {
  const items: KeyValueItem[] = [
    { label: 'Moment', value: formatInstantSeconds(info.t), mono: true },
    {
      label: 'Confirmed nodes',
      value: info.nodes === null ? null : formatInt(info.nodes),
      unknown: info.nodes === null,
    },
    { label: 'Cumulus', value: formatInt(info.tiers.cumulus) },
    { label: 'Nimbus', value: formatInt(info.tiers.nimbus) },
    { label: 'Stratus', value: formatInt(info.tiers.stratus) },
    {
      label: 'On the globe',
      value: `${formatInt(info.located)} of ${formatInt(info.rows)} nodes have a place`,
    },
  ];
  return (
    <Popover
      aria-label="What this moment records"
      placement="bottom-end"
      width={340}
      trigger={<IconButton icon={Info} label="What this moment records" size="sm" />}
      content={
        <Stack gap={5} className="tm-facts">
          <KeyValue items={items} />
          <p className="tm-facts__note">
            <strong>Recorded:</strong> {info.recorded.length > 0 ? info.recorded.join(', ') : 'nothing'}.
          </p>
          {info.missing.length > 0 ? (
            <p className="tm-facts__note">
              <strong>Not recorded for this moment:</strong> {info.missing.join(', ')}. The server stored
              these only later, so the archive leaves them out instead of showing zeros.
            </p>
          ) : null}
        </Stack>
      }
    />
  );
}
