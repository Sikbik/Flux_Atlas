import { ChevronLeft, ChevronRight, FileDiff, Pencil, SearchX, UserRoundCog } from 'lucide-react';
import { useMemo, useState } from 'react';
import { isApiError } from '../../../api/http';
import { useAppDetail, useAppHistory } from '../../../api/queries';
import { formatFlux, formatInt, formatUtcDateTime } from '../../../lib/format';
import {
  AnimatedNumber,
  Button,
  Chip,
  EmptyState,
  EntityLink,
  ErrorState,
  IconButton,
  Section,
  Skeleton,
  Stat,
  StatGrid,
  StatusChip,
  Timeline,
  ViewHeader,
} from '../../../ui';
import {
  buildHistory,
  findRevision,
  revisionCount,
  totalPaid,
  withCurrentValues,
} from '../derive/appHistory';
import { Callout } from '../ui/callout';
import '../ui/parts.css';
import { HistoryButton } from './links';
import { ChangeList, fluxText, revisionItems, useRevisions } from './revisions';
import { plural } from './summary';
import './app.css';

const TRIO_MIN = 156;

/** The revisions of an app as a thread, newest first: the latest few, and the rest one press away. */
export function HistoryPanel({ name }: { name: string }) {
  const rev = useRevisions(name);
  const [all, setAll] = useState(false);
  const limit = 5;
  const items = useMemo(
    () => revisionItems(name, rev.items, { limit: all ? undefined : limit }),
    [name, rev.items, all],
  );
  if (rev.pending) {
    return (
      <div className="ix-skel-rows" aria-hidden="true">
        <Skeleton h={40} />
        <Skeleton h={40} />
      </div>
    );
  }
  if (rev.items.length === 0) return <p className="ix-cap">No spec message is recorded for this app yet.</p>;
  return (
    <div className="ix-hist">
      <Timeline items={items} label="Spec revisions" />
      {rev.items.length > limit ? (
        <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${formatInt(rev.items.length)}`}
        </Button>
      ) : null}
    </div>
  );
}

function RevisionSkeleton() {
  return (
    <article className="ix ix-app ix-revision" aria-busy="true" aria-label="Loading the spec revision">
      <div className="ix-skel-head">
        <Skeleton w={96} h={12} />
        <Skeleton w="52%" h={24} />
        <Skeleton w="62%" h={12} />
      </div>
      <Section>
        <StatGrid min={TRIO_MIN} className="ix-app-trio">
          <Stat label="Changed" loading />
          <Stat label="Spec" loading />
          <Stat label="Paid" loading />
        </StatGrid>
      </Section>
      <Section title="What this message changed">
        <div className="ix-skel-rows">
          <Skeleton h={34} />
          <Skeleton h={34} />
          <Skeleton h={34} />
        </div>
      </Section>
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
  const timeline = useMemo(() => revisionItems(name, items, { selected: n }), [name, items, n]);

  if (hist.isError) {
    const notFound = isApiError(hist.error) && hist.error.code === 'not_found';
    return (
      <article className="ix ix-app" aria-label="Spec revision not found">
        {notFound ? (
          <EmptyState icon={SearchX} title="No app with that name" pattern>
            Nothing in the index is named {name}.
          </EmptyState>
        ) : (
          <ErrorState error={hist.error} onRetry={() => void hist.refetch()} retrying={hist.isFetching} />
        )}
      </article>
    );
  }
  if (hist.isPending) return <RevisionSkeleton />;
  if (!item) {
    return (
      <article className="ix ix-app" aria-label="Spec revision not found">
        <EmptyState
          icon={SearchX}
          title={`No revision ${n}`}
          pattern
          action={
            total > 0 ? (
              <HistoryButton name={name} n={total}>
                Latest revision
              </HistoryButton>
            ) : undefined
          }
        >
          {display} has {plural(total, 'spec revision')}.{' '}
          <EntityLink kind="app" value={name}>
            Back to the app
          </EntityLink>
          .
        </EmptyState>
      </article>
    );
  }

  const isCurrent = n === total;
  const entry = item.type === 'renewals' ? null : item.entry;
  const changes = item.type === 'updated' ? item.changes : [];
  const prev = n > 1 ? n - 1 : null;
  const next = n < total ? n + 1 : null;
  const upgraded =
    item.type === 'updated' && item.versionFrom !== null && item.versionFrom !== item.versionTo;

  return (
    <article className="ix ix-app ix-revision" aria-label={`${display}, spec revision ${n}`}>
      <ViewHeader
        kind={
          <EntityLink kind="app" value={name} icon={ChevronLeft}>
            {display}
          </EntityLink>
        }
        title={
          <>
            Revision {formatInt(n)} <span className="ix-dim">of {formatInt(total)}</span>
          </>
        }
        subtitle={[
          entry?.time_ms ? formatUtcDateTime(entry.time_ms) : 'Time unknown',
          entry ? `block ${formatInt(entry.height)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        freshness={
          <span className="ix-tools">
            {prev ? (
              <HistoryButton name={name} n={prev} icon={ChevronLeft} aria-label={`Revision ${prev}`} />
            ) : (
              <IconButton
                size="sm"
                variant="secondary"
                icon={ChevronLeft}
                label="No earlier revision"
                disabled
              />
            )}
            {next ? (
              <HistoryButton name={name} n={next} icon={ChevronRight} aria-label={`Revision ${next}`} />
            ) : (
              <IconButton
                size="sm"
                variant="secondary"
                icon={ChevronRight}
                label="No later revision"
                disabled
              />
            )}
          </span>
        }
      >
        {item.type === 'registered' ? (
          <StatusChip status="confirmed" label={item.again ? 'Registered again' : 'Registered'} size="sm" />
        ) : item.type === 'updated' ? (
          <Chip tone="accent" size="sm" icon={Pencil}>
            Updated
          </Chip>
        ) : null}
        {entry ? (
          <Chip mono size="sm">
            spec v{entry.spec_version}
          </Chip>
        ) : null}
        {isCurrent ? <Chip size="sm">Current</Chip> : null}
      </ViewHeader>

      <Section>
        <StatGrid min={TRIO_MIN} className="ix-app-trio">
          {item.type === 'updated' ? (
            <Stat
              label="Changed"
              value={<AnimatedNumber value={changes.length} />}
              unit={changes.length === 1 ? 'field' : 'fields'}
            />
          ) : null}
          <Stat
            label="Spec"
            value={entry ? `v${entry.spec_version}` : null}
            caption={
              item.type === 'updated'
                ? upgraded
                  ? `upgraded from v${item.versionFrom}`
                  : 'same format'
                : undefined
            }
          />
          <Stat
            label="Paid"
            value={entry?.paid ? formatFlux(entry.paid, { unit: false }) : null}
            unit={entry?.paid ? 'FLUX' : undefined}
          />
        </StatGrid>
      </Section>

      {item.type === 'updated' && item.ownerChanged ? (
        <div className="ix-pad ix-callouts">
          <Callout tone="warn" icon={<UserRoundCog size={16} strokeWidth={1.5} />} title="Ownership changed">
            The owner of the app is different after this message.
          </Callout>
        </div>
      ) : null}

      <Section title="What this message changed">
        {item.type === 'registered' ? (
          <p className="ix-cap ix-cap-first">
            {item.again
              ? 'The app was registered again after it expired; the whole specification was set in this message.'
              : 'The first message of the app: the whole specification was set here, so there is nothing earlier to compare against.'}
          </p>
        ) : changes.length === 0 ? (
          <p className="ix-cap ix-cap-first">
            The message carried no field changes the server could tell apart (a pure re-sign).
          </p>
        ) : (
          <ChangeList changes={changes} />
        )}
        <p className="ix-cap">
          {[
            item.type === 'registered'
              ? null
              : isCurrent
                ? 'Values are today’s, because this is the current revision.'
                : 'Atlas records which fields each message changed, not their earlier values.',
            spec?.enterprise ? 'Enterprise apps are encrypted, so only public fields appear.' : null,
            'Environment values are never shown.',
          ]
            .filter(Boolean)
            .join(' ')}
        </p>
      </Section>

      <Section
        title="All revisions"
        icon={FileDiff}
        aside={
          <span>
            {fluxText(paid)} <span className="ix-dim">FLUX paid</span>
          </span>
        }
      >
        <Timeline items={timeline} label="Spec revisions" timeMode="absolute" />
      </Section>
    </article>
  );
}
