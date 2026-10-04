// Who moved on the rich list, over a day, a week or a month: the addresses that gained and lost the most, who entered
// the ranking and who left it, and how the top-ten share drifted. It is the body of the landing's rich list card (a few
// of each) and of the movers section of the Rich list page (ten, then "Show all"). The server saves one picture of the
// ranking a day and compares two of them, so until the second picture exists the block says so, as a state of its own
// and never as an error.

import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CalendarClock, ChevronDown, Minus, Sparkle } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import type { RichMoversDto } from '../../../api/generated/RichMoversDto';
import type { RichMoversWindow } from '../../../api/generated/RichMoversWindow';
import { formatCompact, formatInt } from '../../../lib/format';
import { Button, EmptyState, ErrorState, SegmentedControl, Skeleton, Sparkline } from '../../../ui';
import { formatDate } from '../../wallet/lib/dates';
import { AddressTag } from '../views/shared';
import {
  type EnteredRow,
  type LeftRow,
  MOVER_WINDOWS,
  type MoverRow,
  moversView,
  type RankShift,
  shiftText,
  signedFlux,
  trackingNote,
  trendText,
  windowOption,
} from './lib/movers';
import './holders.css';

const WINDOW_OPTIONS = MOVER_WINDOWS.map((w) => ({ value: w.id, label: w.label }));

function RankChip({ shift }: { shift: RankShift | null }) {
  if (!shift) return null;
  const text = shiftText(shift);
  let body: ReactNode;
  if (shift.kind === 'up' || shift.kind === 'down') {
    const Icon = shift.kind === 'up' ? ArrowUp : ArrowDown;
    body = (
      <>
        <Icon size={11} strokeWidth={2} aria-hidden="true" />
        {shift.places}
      </>
    );
  } else if (shift.kind === 'new') {
    body = (
      <>
        <Sparkle size={11} strokeWidth={2} aria-hidden="true" />
        New
      </>
    );
  } else if (shift.kind === 'same') {
    body = <Minus size={11} strokeWidth={2} aria-hidden="true" />;
  } else body = 'Left';
  return (
    <span className="ex-shift" data-dir={shift.kind} title={text}>
      <span className="ui-sr-only">{text}: </span>
      {body}
    </span>
  );
}

function MoverItem({ row, tone }: { row: MoverRow; tone: 'gain' | 'loss' }) {
  return (
    <li className="ex-mv" data-tone={tone}>
      <RankChip shift={row.shift} />
      <span className="ex-mv__who">
        <AddressTag address={row.address} />
        <span className="ex-mv__sub">
          {row.rank === null ? 'left the list' : `now #${formatInt(row.rank)}`}
          {row.prevRank !== null && row.rank !== row.prevRank ? `, was #${formatInt(row.prevRank)}` : ''}
          {row.nodes > 0 ? `, ${formatInt(row.nodes)} ${row.nodes === 1 ? 'node' : 'nodes'}` : ''}
        </span>
      </span>
      <span className="ex-mv__delta">
        <span className="ui-sr-only">{row.deltaFlux > 0 ? 'Gained ' : 'Lost '}</span>
        {signedFlux(row.deltaFlux)}
        <span className="ex-mv__unit">FLUX</span>
      </span>
    </li>
  );
}

function MoverList({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: readonly MoverRow[];
  tone: 'gain' | 'loss';
}) {
  const id = useId();
  return (
    <section className="ex-mvs" aria-labelledby={id}>
      <h4 id={id} className="ex-mvs__title" data-tone={tone}>
        {title}
      </h4>
      {rows.length === 0 ? (
        <p className="ex-mvs__none">{tone === 'gain' ? 'No address gained.' : 'No address lost.'}</p>
      ) : (
        <ol className="ex-mvs__list">
          {rows.map((r) => (
            <MoverItem key={r.address} row={r} tone={tone} />
          ))}
        </ol>
      )}
    </section>
  );
}

/** Entered or left the ranking: a short list that opens to the whole one. */
function Movement({
  title,
  total,
  limit,
  children,
}: {
  title: string;
  total: number;
  limit: number;
  children: (shown: number) => ReactNode;
}) {
  const id = useId();
  const [all, setAll] = useState(false);
  const shown = all ? total : Math.min(total, limit);
  return (
    <section className="ex-mvs" aria-labelledby={id}>
      <h4 id={id} className="ex-mvs__title">
        {title}
        <span className="ex-mvs__count">{formatInt(total)}</span>
      </h4>
      {total === 0 ? (
        <p className="ex-mvs__none">None in this window.</p>
      ) : (
        <>
          <div
            className="ex-mvs__scroll"
            data-open={all || undefined}
            tabIndex={all && total > 12 ? 0 : undefined}
          >
            <ol className="ex-mvs__list">{children(shown)}</ol>
          </div>
          {total > limit ? (
            <Button
              size="sm"
              variant="ghost"
              iconRight={ChevronDown}
              aria-expanded={all}
              onClick={() => setAll((v) => !v)}
              className="ex-mvs__more"
            >
              {all ? 'Show fewer' : `Show all ${formatInt(total)}`}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

function EnteredItem({ row }: { row: EnteredRow }) {
  return (
    <li className="ex-mv" data-tone="neutral">
      <span className="ex-shift" data-dir="new">
        <span className="ui-sr-only">Entered at </span>#{formatInt(row.rank)}
      </span>
      <span className="ex-mv__who">
        <AddressTag address={row.address} />
        {row.nodes > 0 ? (
          <span className="ex-mv__sub">{`${formatInt(row.nodes)} ${row.nodes === 1 ? 'node' : 'nodes'}`}</span>
        ) : null}
      </span>
      <span className="ex-mv__delta">
        {formatCompact(row.flux)}
        <span className="ex-mv__unit">FLUX</span>
      </span>
    </li>
  );
}

function LeftItem({ row }: { row: LeftRow }) {
  return (
    <li className="ex-mv" data-tone="neutral">
      <span className="ex-shift" data-dir="gone">
        <span className="ui-sr-only">Was </span>#{formatInt(row.prevRank)}
      </span>
      <span className="ex-mv__who">
        <AddressTag address={row.address} />
      </span>
      <span className="ex-mv__delta">
        {formatCompact(row.prevFlux)}
        <span className="ex-mv__unit">FLUX</span>
      </span>
    </li>
  );
}

export interface MoversBlockProps {
  query: Pick<
    UseQueryResult<RichMoversDto>,
    'data' | 'isPending' | 'isError' | 'error' | 'refetch' | 'isFetching'
  >;
  window: RichMoversWindow;
  onWindow: (w: RichMoversWindow) => void;
  /** `card`: a few of each, in one column. `page`: ten, then "Show all", in two columns. */
  variant: 'card' | 'page';
}

export function MoversBlock({ query, window, onWindow, variant }: MoversBlockProps) {
  const dto = query.data;
  const top = variant === 'card' ? 3 : 10;
  const view = dto ? moversView(dto, top) : null;
  const opt = windowOption(window);

  const control = (
    <SegmentedControl
      size="sm"
      aria-label="Window the movers are compared over"
      options={WINDOW_OPTIONS}
      value={window}
      onChange={onWindow}
    />
  );

  let body: ReactNode;
  if (!dto) {
    body = query.isError ? (
      <ErrorState
        compact
        framed={false}
        error={query.error}
        title="Could not load the movers"
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      >
        The comparison is built from the daily pictures of the ranking; try again in a moment.
      </ErrorState>
    ) : (
      <div className="ex-movers__skeleton" aria-hidden="true">
        <Skeleton w="55%" h={12} />
        <Skeleton h={30} radius={8} />
        <Skeleton h={30} radius={8} />
        <Skeleton h={30} radius={8} />
      </div>
    );
  } else if (view?.state === 'tracking') {
    const note = trackingNote(view.snapshots);
    body = (
      <EmptyState compact pattern icon={CalendarClock} title="Movers appear after the second daily snapshot">
        <span className="ex-movers__tracking">{note.body}</span>
      </EmptyState>
    );
  } else if (view) {
    const trend = view.trend;
    body = (
      <div className="ex-movers__ready">
        <p className="ex-movers__span">
          {`Compared with ${formatDate(view.fromMs)}, ${view.spanDays} ${view.spanDays === 1 ? 'day' : 'days'} earlier.`}
          {view.partial ? ` The server has not kept ${opt.phrase} of pictures yet.` : ''}
        </p>
        {trend ? (
          <div className="ex-movers__trend">
            <Sparkline
              size="card"
              form="area"
              values={trend.values}
              label={`Share of the supply held by the largest ten, from ${trend.first.toFixed(1)} to ${trend.last.toFixed(1)} percent`}
            />
            <p>
              {`The largest ten hold ${trend.last.toFixed(1)}% of the supply, ${trendText(trend.change)} since ${formatDate(trend.fromMs)}.`}
            </p>
          </div>
        ) : null}
        {view.quiet ? (
          <p className="ex-mvs__none">No address gained, lost, entered or left over this window.</p>
        ) : (
          <div className="ex-movers__lists" data-variant={variant}>
            <MoverList title="Gained the most" rows={view.gainers} tone="gain" />
            <MoverList title="Lost the most" rows={view.losers} tone="loss" />
            {variant === 'page' ? (
              <>
                <Movement title="Entered the ranking" total={view.entered.length} limit={10}>
                  {(n) => view.entered.slice(0, n).map((r) => <EnteredItem key={r.address} row={r} />)}
                </Movement>
                <Movement title="Left the ranking" total={view.left.length} limit={10}>
                  {(n) => view.left.slice(0, n).map((r) => <LeftItem key={r.address} row={r} />)}
                </Movement>
              </>
            ) : (
              <p className="ex-movers__flow">
                {`${formatInt(view.entered.length)} entered the ranking and ${formatInt(view.left.length)} left it.`}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // Until there are two pictures to compare there is nothing to choose a window for: the head is the state's own. On the
  // Rich list page the section already says "Movers", so its head only names the window.
  const tracking = view?.state === 'tracking';
  const title = variant === 'page' ? `Over ${opt.phrase}` : `Movers over ${opt.phrase}`;
  return (
    <div className="ex-movers" data-variant={variant} data-stale={(query.isFetching && !!dto) || undefined}>
      {tracking && variant === 'page' ? null : (
        <div className="ex-movers__head">
          <h3 className="ex-movers__title">{tracking ? 'Movers' : title}</h3>
          {tracking ? null : control}
        </div>
      )}
      {body}
    </div>
  );
}
