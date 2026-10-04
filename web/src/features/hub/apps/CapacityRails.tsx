// The hero's graphic: what apps lock of the network's capacity, as three rails (CPU, memory, storage), each a kit
// Meter so it is a real `meter` with its reading as text. The fills are small by nature (apps hold a tenth of the
// cores and less of the rest) and the track is the whole network, so the length of a fill is honest.
//
// The sizes count the apps whose spec is public. An enterprise app keeps its components private, so what apps hold is
// at least this much, and the rails say so in a line under them.
//
// While the overview is on its way, still being read by the server, or failed, the rails are the loaded ones drawn
// from made-up numbers (a ghost), so the hero is as tall as it will be and nothing under it moves when the answer
// lands. A failure is laid over the ghost, which keeps its room.

import { type CSSProperties, useMemo } from 'react';
import type { AppsOverviewDto } from '../../../api/generated/AppsOverviewDto';
import { ErrorState, Meter } from '../../../ui';
import type { HubQuery } from '..';
import { Ghost, WaitAside } from './ghost';
import { type RailRow, railRows, railsNote, railsSummary } from './lib/capacity';
import { GHOST_ENTERPRISE_APPS, GHOST_RESOURCES } from './lib/placeholders';
import { isWaiting, panelError } from './parts';

const GHOST_ROWS = railRows(GHOST_RESOURCES);

function Lane({ row, i }: { row: RailRow; i: number }) {
  return (
    <li className="ap-rail" style={{ '--i': i } as CSSProperties}>
      <div className="ap-rail__head" aria-hidden="true">
        <span className="ap-rail__name">{row.label}</span>
        <span className="ap-rail__of">
          {row.usedText} <span data-unknown={row.share === null || undefined}>{row.ofText}</span>
        </span>
        <span className="ap-rail__pct">{row.percent}</span>
      </div>
      <Meter
        label={`${row.label} locked by apps`}
        value={row.share}
        size="lg"
        format={() => `${row.percent}, ${row.usedText}, ${row.ofText}`}
      />
    </li>
  );
}

function Lanes({ rows }: { rows: readonly RailRow[] }) {
  return (
    <ul className="ap-rails__list">
      {rows.map((r, i) => (
        <Lane key={r.key} row={r} i={i} />
      ))}
    </ul>
  );
}

export function CapacityRails({
  overview,
  enterpriseApps,
}: {
  overview: HubQuery<AppsOverviewDto>;
  /** Enterprise apps in the index, for the line under the rails; null while it is not known. */
  enterpriseApps: number | null;
}) {
  const o = overview.data;
  const rows = useMemo(() => (o ? railRows(o.resources) : null), [o]);

  if (!rows) {
    const failed = overview.isError;
    const failure = panelError(overview.error, 'the capacity');
    return (
      <div
        className="ap-rails"
        data-state={failed ? 'error' : 'loading'}
        aria-busy={failed ? undefined : true}
      >
        <p className="ap-rails__title">
          <span>Locked by apps</span>
          {isWaiting(overview) ? (
            <WaitAside what="The capacity" />
          ) : (
            <span className="ap-rails__sub">of the network&rsquo;s benchmarked capacity</span>
          )}
        </p>
        <div className="ap-hold" data-failed={failed || undefined}>
          <Ghost className="ap-hold__under">
            <Lanes rows={GHOST_ROWS} />
            <p className="ap-rails__note">{railsNote(enterpriseApps ?? GHOST_ENTERPRISE_APPS)}</p>
          </Ghost>
          {failed ? (
            <div className="ap-hold__over">
              <ErrorState
                compact
                framed={false}
                error={overview.error}
                onRetry={() => void overview.refetch()}
                retrying={overview.isFetching}
                title={failure.errorTitle}
              >
                {failure.errorText}
              </ErrorState>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <figure className="ap-rails" data-state="ready" aria-label="What apps lock of the network's capacity">
      <figcaption className="ap-rails__title">
        <span>Locked by apps</span>
        <span className="ap-rails__sub">of the network&rsquo;s benchmarked capacity</span>
      </figcaption>
      <p className="ui-sr-only">{railsSummary(rows)}</p>
      <Lanes rows={rows} />
      <p className="ap-rails__note">{railsNote(enterpriseApps)}</p>
    </figure>
  );
}
