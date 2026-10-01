// The history of an app's specification as the inspectors show it: the revisions as a kit Timeline (newest
// first, renewals grouped), and the change list of one revision. The server records which fields each
// message changed, not their old values, so a change says what and in which direction.

import { Minus, PackagePlus, Pencil, Plus, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';
import { useAppHistory } from '../../../api/queries';
import { formatSats } from '../../../lib/format';
import { Amount, type TimelineItem } from '../../../ui';
import {
  buildHistory,
  type ChangeLine,
  groupChanges,
  type HistoryItem,
  revisionCount,
  summarizeChanges,
} from '../derive/appHistory';
import { HistoryLink } from './links';

/** FLUX in base units as text, without the unit (the unit is said once, beside the figure). */
export const fluxText = (base: bigint): string => formatSats(base, { unit: false });

/** The revisions of an app from its history, with the count and whether the history is still loading. */
export function useRevisions(name: string) {
  const q = useAppHistory(name);
  const items = useMemo(() => buildHistory(q.data?.entries ?? []), [q.data]);
  return { items, total: revisionCount(items), pending: q.isPending };
}

/** The time of the newest registration or update, in unix ms (null when no message carries one). */
export function lastChangeMs(items: readonly HistoryItem[]): number | null {
  let last: number | null = null;
  for (const it of items) if (it.type !== 'renewals') last = it.entry.time_ms ?? last;
  return last;
}

const typeWord = (it: Extract<HistoryItem, { type: 'registered' | 'updated' }>): string =>
  it.type === 'registered' ? (it.again ? 'Registered again' : 'Registered') : 'Updated';

/**
 * The revisions of an app as Timeline items, newest first. A registration or an update links to its own
 * page (`selected` marks the one being read); a run of renewals is one grouped item.
 */
export function revisionItems(
  name: string,
  items: readonly HistoryItem[],
  opts: { selected?: number; limit?: number } = {},
): TimelineItem[] {
  const list = [...items].reverse();
  const shown = opts.limit === undefined ? list : list.slice(0, opts.limit);
  return shown.map<TimelineItem>((it) => {
    if (it.type === 'renewals') {
      const n = it.to - it.from + 1;
      return {
        id: `r${it.from}`,
        time: it.entries.at(-1)?.time_ms ?? Number.NaN,
        icon: RefreshCw,
        tone: 'neutral',
        title: 'Renewed',
        count: n,
        meta: (
          <>
            Messages {it.from}
            {it.to !== it.from ? ` to ${it.to}` : ''} · spec v{it.specVersion} ·{' '}
            <Amount value={it.paid} unit />
          </>
        ),
        block: it.entries.at(-1)?.height,
      };
    }
    const current = opts.selected === it.rev;
    const detail =
      it.type === 'updated'
        ? [
            summarizeChanges(it.changes),
            it.versionFrom !== null && it.versionFrom !== it.versionTo
              ? `v${it.versionFrom} to v${it.versionTo}`
              : null,
          ]
        : [`Spec v${it.entry.spec_version}`];
    return {
      id: `v${it.rev}`,
      time: it.entry.time_ms ?? Number.NaN,
      icon: it.type === 'registered' ? PackagePlus : Pencil,
      tone: current ? 'hot' : it.type === 'registered' ? 'ok' : 'accent',
      title: current ? (
        <span aria-current="page">{typeWord(it)}</span>
      ) : (
        <HistoryLink name={name} n={it.rev} aria-label={`Revision ${it.rev}, ${typeWord(it).toLowerCase()}`}>
          {typeWord(it)}
        </HistoryLink>
      ),
      meta: (
        <>
          Revision {it.rev}
          {detail.filter(Boolean).map((d) => (
            <span key={d}> · {d}</span>
          ))}
          {it.entry.paid ? (
            <>
              {' '}
              · <Amount value={it.entry.paid} unit />
            </>
          ) : null}
        </>
      ),
      block: it.entry.height,
    };
  });
}

const KIND_ICON = { changed: Pencil, added: Plus, removed: Minus } as const;

/** One field: its name (and today's value on the current revision). A plain change is the section's own
 * subject, so only an addition or a removal says so in words, beside its glyph and tint. */
function ChangeRow({ c }: { c: ChangeLine }) {
  const Icon = KIND_ICON[c.kind];
  return (
    <li className="ix-chg" data-kind={c.kind}>
      <span className="ix-chg-i" aria-hidden="true">
        <Icon size={12} strokeWidth={2} />
      </span>
      <span className="ix-chg-main">
        <b>{c.label}</b>
        {c.value !== undefined ? <span className="ix-chg-v">{c.value}</span> : null}
      </span>
      {c.kind === 'changed' ? null : <span className="ix-chg-k">{c.kind}</span>}
    </li>
  );
}

/** The fields one message changed, grouped by the app and by each component. */
export function ChangeList({ changes }: { changes: readonly ChangeLine[] }) {
  const groups = useMemo(() => groupChanges(changes), [changes]);
  return (
    <div className="ix-chg-groups">
      {groups.map((g) => (
        <section className="ix-chg-group" key={g.scope ?? 'app'} aria-label={g.scope ?? 'The app'}>
          <h4 className="ix-chg-scope">{g.scope === null ? 'The app' : `Component ${g.scope}`}</h4>
          <ul className="ix-chg-list">
            {g.lines.map((c) => (
              <ChangeRow key={c.path} c={c} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
