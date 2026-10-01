import { ChevronLeft, ChevronRight, Minus, Pencil, Plus, RefreshCw, SearchX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isApiError } from '../../../api/http';
import { useAppDetail, useAppHistory } from '../../../api/queries';
import { useRuntime } from '../../../app/context';
import { formatAgo, formatFlux, formatInt, formatSats, formatUtcDateTime } from '../../../lib/format';
import {
  buildHistory,
  type ChangeLine,
  findRevision,
  groupChanges,
  type HistoryItem,
  revisionCount,
  summarizeChanges,
  totalPaid,
  withCurrentValues,
} from '../derive/appHistory';
import {
  AccentChip,
  Alert,
  AppHistoryLink,
  AppLink,
  Btn,
  Chip,
  Digits,
  Grid,
  Sk,
  State,
  StatusChip,
  Tile,
} from '../ui';
import './app.css';

const fluxText = (base: bigint) => formatSats(base, { unit: false });

/** The revisions of an app from its history, with the count and whether the history is still loading. */
export function useRevisions(name: string) {
  const q = useAppHistory(name);
  const items = useMemo(() => buildHistory(q.data?.entries ?? []), [q.data]);
  return { items, total: revisionCount(items), pending: q.isPending };
}

/** The revisions of an app, newest first: registrations and updates link to their diff, renewals are grouped. */
export function HistoryList({
  name,
  items,
  selected,
  limit,
}: {
  name: string;
  items: readonly HistoryItem[];
  selected?: number;
  limit?: number;
}) {
  const { clock } = useRuntime();
  const [all, setAll] = useState(false);
  const now = clock.now();
  const list = [...items].reverse();
  const shown = all || limit === undefined ? list : list.slice(0, limit);
  return (
    <>
      <ol className="ix-hist" aria-label="Spec revisions">
        {shown.map((it) => {
          if (it.type === 'renewals') {
            return (
              <li className="ix-hist-row" data-kind="renewals" key={`r${it.from}`}>
                <span className="ix-hist-rev" aria-hidden="true">
                  <RefreshCw size={12} strokeWidth={1.75} />
                </span>
                <span className="ix-hist-main">
                  <span className="ix-hist-t">
                    {it.to === it.from ? 'Renewed' : `Renewed ${it.to - it.from + 1} times`}
                  </span>
                  <span className="ix-hist-s">
                    Messages {it.from}
                    {it.to !== it.from ? ` to ${it.to}` : ''} · spec v{it.specVersion}
                  </span>
                </span>
                <span className="ix-mono ix-hist-paid">{fluxText(it.paid)}</span>
                <span aria-hidden="true" />
              </li>
            );
          }
          const when = it.entry.time_ms ? formatAgo(now - it.entry.time_ms) : null;
          const current = selected === it.rev;
          return (
            <li
              className="ix-hist-row"
              key={`v${it.rev}`}
              data-kind={it.type}
              data-selected={current || undefined}
            >
              <AppHistoryLink
                name={name}
                n={it.rev}
                className="ix-hist-link"
                aria-current={current ? 'page' : undefined}
              >
                <span className="ix-hist-rev ix-mono">{it.rev}</span>
                <span className="ix-hist-main">
                  <span className="ix-hist-t">
                    {it.type === 'registered' ? (it.again ? 'Registered again' : 'Registered') : 'Updated'}
                    {when ? <span className="ix-dim"> · {when}</span> : null}
                  </span>
                  <span className="ix-hist-s">
                    {it.type === 'updated'
                      ? `${summarizeChanges(it.changes)}${it.versionFrom !== null && it.versionFrom !== it.versionTo ? ` · v${it.versionFrom} to v${it.versionTo}` : ''}`
                      : `Spec v${it.entry.spec_version}`}
                  </span>
                </span>
                <span className="ix-mono ix-hist-paid">
                  {it.entry.paid ? formatFlux(it.entry.paid, { unit: false }) : ''}
                </span>
                <ChevronRight className="ix-hrow-chev" size={14} strokeWidth={1.75} aria-hidden="true" />
              </AppHistoryLink>
            </li>
          );
        })}
      </ol>
      {limit !== undefined && list.length > limit ? (
        <div className="ix-more">
          <Btn variant="ghost" onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${list.length}`}
          </Btn>
        </div>
      ) : null}
    </>
  );
}

const KIND_ICON = { changed: Pencil, added: Plus, removed: Minus } as const;
const KIND_WORD = { changed: 'Changed', added: 'Added', removed: 'Removed' } as const;

function ChangeRow({ c }: { c: ChangeLine }) {
  const Icon = KIND_ICON[c.kind];
  return (
    <li className="ix-chg" data-kind={c.kind}>
      <span className="ix-chg-i" aria-hidden="true">
        <Icon size={12} strokeWidth={2} />
      </span>
      <span className="ix-chg-main">
        <b>{c.label}</b>
        {c.value !== undefined ? <span className="ix-mono ix-chg-v">{c.value}</span> : null}
      </span>
      <span className="ix-chg-k">{KIND_WORD[c.kind].toLowerCase()}</span>
    </li>
  );
}

function HistorySkeleton() {
  return (
    <article className="ix ix-app" aria-busy="true" aria-label="Loading the spec revision">
      <div className="ix-lead">
        <Sk h={22} w="60%" />
        <div className="ix-gap">
          <Sk h={86} r={14} />
        </div>
        <div className="ix-gap">
          <Sk h={180} r={12} />
        </div>
      </div>
    </article>
  );
}

/**
 * One spec revision of an app (`/app/:name/history/:n`): what that message changed, in words, grouped by
 * component. The server records which fields changed, not their old values, so the diff says what and in
 * which direction; the current revision also shows today's values.
 */
export function AppHistoryView({ name, n }: { name: string; n: number }) {
  const hist = useAppHistory(name);
  const detail = useAppDetail(name);
  const items = useMemo(() => buildHistory(hist.data?.entries ?? []), [hist.data]);
  const total = revisionCount(items);
  const found = findRevision(items, n);
  const spec = detail.data?.spec ?? null;
  const item = found && n === total && spec ? withCurrentValues(found, spec) : found;
  const display = detail.data?.display_name ?? name;
  const paid = useMemo(() => totalPaid(hist.data?.entries ?? []), [hist.data]);

  if (hist.isError) {
    const notFound = isApiError(hist.error) && hist.error.code === 'not_found';
    return (
      <article className="ix ix-app" aria-label="Spec revision not found">
        <State
          icon={<SearchX size={20} strokeWidth={1.5} />}
          tone={notFound ? undefined : 'crit'}
          title={notFound ? 'No app with that name' : 'Could not load the history'}
          action={
            notFound ? undefined : (
              <Btn variant="primary" onClick={() => void hist.refetch()}>
                Try again
              </Btn>
            )
          }
        >
          {notFound
            ? `Nothing in the index is named ${name}.`
            : 'The server did not answer; try again in a moment.'}
        </State>
      </article>
    );
  }
  if (hist.isPending) return <HistorySkeleton />;
  if (!item) {
    return (
      <article className="ix ix-app" aria-label="Spec revision not found">
        <State icon={<SearchX size={20} strokeWidth={1.5} />} title={`No revision ${n}`}>
          {display} has {total} spec {total === 1 ? 'revision' : 'revisions'}.{' '}
          <AppLink name={name}>Back to the app</AppLink>
        </State>
      </article>
    );
  }

  const isCurrent = n === total;
  const entry = item.type === 'renewals' ? null : item.entry;
  const changes = item.type === 'updated' ? item.changes : [];
  const groups = groupChanges(changes);
  const prev = n > 1 ? n - 1 : null;
  const next = n < total ? n + 1 : null;

  return (
    <article className="ix ix-app ix-revision" aria-label={`${display}, spec revision ${n}`}>
      <header className="ix-rev-head">
        <AppLink name={name} className="ix-rev-back">
          <ChevronLeft size={14} strokeWidth={1.75} aria-hidden="true" />
          {display}
        </AppLink>
        <h2 className="ix-rev-title">
          Revision <Digits value={String(n)} /> <span className="ix-dim">of {total}</span>
        </h2>
        <div className="ix-chips">
          {item.type === 'registered' ? (
            <StatusChip tone="ok" icon="check">
              {item.again ? 'Registered again' : 'Registered'}
            </StatusChip>
          ) : item.type === 'updated' ? (
            <AccentChip icon={<Pencil size={13} strokeWidth={1.75} />}>Updated</AccentChip>
          ) : null}
          {entry ? <Chip mono>spec v{entry.spec_version}</Chip> : null}
          {isCurrent ? <Chip>Current</Chip> : null}
        </div>
        <p className="ix-rev-when ix-dim">
          {entry?.time_ms ? formatUtcDateTime(entry.time_ms) : 'Time unknown'}
          {entry ? ` · block ${formatInt(entry.height)}` : ''}
        </p>
        <div className="ix-actions ix-rev-nav">
          {prev ? (
            <AppHistoryLink name={name} n={prev} className="ix-btn">
              <ChevronLeft size={14} strokeWidth={1.75} aria-hidden="true" />
              Revision {prev}
            </AppHistoryLink>
          ) : null}
          <span className="ix-actions-gap" aria-hidden="true" />
          {next ? (
            <AppHistoryLink name={name} n={next} className="ix-btn">
              Revision {next}
              <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </AppHistoryLink>
          ) : null}
        </div>
      </header>

      <div className="ix-lead">
        <Grid cols={3}>
          <Tile
            label={item.type === 'registered' ? 'Set here' : 'Changed'}
            value={item.type === 'registered' ? 'All' : <Digits value={String(changes.length)} />}
            unit={item.type === 'registered' ? undefined : changes.length === 1 ? 'field' : 'fields'}
            detail=" "
          />
          <Tile
            label="Spec"
            value={entry ? `v${entry.spec_version}` : ' '}
            detail={
              item.type === 'updated' && item.versionFrom !== null && item.versionFrom !== item.versionTo
                ? `upgraded from v${item.versionFrom}`
                : 'same format'
            }
            detailTone={item.type === 'updated' && item.versionFrom !== item.versionTo ? 'accent' : undefined}
          />
          <Tile
            label="Paid"
            value={entry?.paid ? formatFlux(entry.paid, { unit: false }) : 'Unknown'}
            unit={entry?.paid ? 'FLUX' : undefined}
            detail=" "
          />
        </Grid>

        {item.type === 'updated' && item.ownerChanged ? (
          <div className="ix-gap">
            <Alert tone="warn" title="Ownership changed">
              The owner of the app is different after this message.
            </Alert>
          </div>
        ) : null}

        <h3 className="ix-lead-h">What this message changed</h3>
        {item.type === 'registered' ? (
          <p className="ix-cap">
            {item.again
              ? 'The app was registered again after it expired; the whole specification was set in this message.'
              : 'The first message of the app: the whole specification was set here, so there is nothing earlier to compare against.'}
          </p>
        ) : groups.length === 0 ? (
          <p className="ix-cap">
            The message carried no field changes the server could tell apart (a pure re-sign).
          </p>
        ) : (
          groups.map((g) => (
            <section className="ix-chg-group" key={g.scope ?? 'app'}>
              <h4 className="ix-blk-h">
                <span>{g.scope === null ? 'The app' : `Component ${g.scope}`}</span>
              </h4>
              <ul className="ix-chglist">
                {g.lines.map((c) => (
                  <ChangeRow key={c.path} c={c} />
                ))}
              </ul>
            </section>
          ))
        )}
        <p className="ix-cap">
          {isCurrent
            ? 'Values are today’s, because this is the current revision. '
            : 'Atlas records which fields each message changed, not their earlier values. '}
          {spec?.enterprise ? 'Enterprise apps are encrypted, so only public fields appear. ' : ''}
          Environment values are never shown.
        </p>
      </div>

      <div className="ix-lead">
        <h3 className="ix-lead-h">
          All revisions <span className="ix-dim">· {fluxText(paid)} FLUX paid in total</span>
        </h3>
        <HistoryList name={name} items={items} selected={n} />
      </div>
    </article>
  );
}
