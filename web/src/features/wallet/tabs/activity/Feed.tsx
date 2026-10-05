// The activity feed: the newest events of the fleet, as a timeline a person can read down, with the rhythm of the whole
// window above it and filters that work on both. Payments, health, changes to the nodes and apps are the groups; a
// search finds a node or a word. A burst of one kind at one moment shows in the chart as a spike before it shows in
// the list as a run of rows. New events slide in at the top as they arrive.

import { Activity, SearchX } from 'lucide-react';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { formatAgo, formatInt } from '../../../../lib/format';
import { Button, Chip, EmptyState, SearchField, Timeline } from '../../../../ui';
import { useWalletCtx } from '../../context';
import {
  ACTIVITY_GROUPS,
  type ActivityGroup,
  activityWindow,
  countByGroup,
  filterActivity,
  newestFirst,
  paymentSummary,
  rhythm,
  searchActivity,
} from '../../lib/activity';
import { Panel } from '../../ui/Panel';
import { RhythmChart } from '../../viz/RhythmChart';
import { activityItems } from './rows';

/** Rows shown at first, and added by each press of "Show more". */
const PAGE = 30;
/** The server keeps this many events per wallet. */
const KEPT = 200;

const NO_GROUPS: ReadonlySet<ActivityGroup> = new Set();

export function Feed() {
  const { dto, fleet, money, globe, addr } = useWalletCtx();
  const items = useMemo(() => newestFirst(dto.activity), [dto.activity]);
  const rows = useMemo(() => new Map(fleet.rows.map((r) => [r.key, r])), [fleet.rows]);
  const nameOf = useCallback(
    (key: string | null) => (key === null ? '' : rows.get(key)?.endpoint || key),
    [rows],
  );

  const [on, setOn] = useState<ReadonlySet<ActivityGroup>>(NO_GROUPS);
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(PAGE);
  // Typing filters two hundred rows; the field stays instant and the list follows when the typing pauses.
  const needle = useDeferredValue(text);

  const counts = useMemo(() => countByGroup(items), [items]);
  const win = useMemo(() => activityWindow(items), [items]);
  const rhy = useMemo(() => rhythm(items), [items]);
  const pay = useMemo(() => paymentSummary(items), [items]);
  const kept = useMemo(
    () => searchActivity(filterActivity(items, on), needle, nameOf),
    [items, on, needle, nameOf],
  );
  const shown = useMemo(() => kept.slice(0, limit), [kept, limit]);
  const timeline = useMemo(
    () => activityItems(shown, { rows, money, hover: globe.hover }),
    [shown, rows, money, globe.hover],
  );

  const filtered = on.size > 0 || needle.trim() !== '';
  const toggle = (g: ActivityGroup) => {
    setOn((cur) => {
      const next = new Set(cur);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
    setLimit(PAGE);
  };
  const clear = () => {
    setOn(NO_GROUPS);
    setText('');
    setLimit(PAGE);
  };

  if (items.length === 0) {
    return (
      <Panel title="Activity" icon={Activity}>
        <EmptyState compact icon={Activity} title="No event yet">
          Atlas records starts, payments, expiries, DOS listings, reachability, benchmark and version changes
          as they happen, and lists them here. Nothing has been recorded for these nodes yet.
        </EmptyState>
      </Panel>
    );
  }

  const back = win ? formatAgo(Date.now() - win.from) : '';
  const summary = [
    items.length >= KEPT
      ? `The newest ${formatInt(KEPT)} events, back to ${back}. A node's own page goes further back.`
      : `${formatInt(items.length)} ${items.length === 1 ? 'event' : 'events'}, back to ${back}.`,
    pay.count > 0
      ? `${formatInt(pay.count)} ${pay.count === 1 ? 'payment' : 'payments'} among them paid ${pay.flux.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} FLUX on the main chain${money.price === null ? '' : `, worth ${money.text(pay.flux)} at today's price`}.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const total = kept.length;
  const status = filtered
    ? `${formatInt(total)} of ${formatInt(items.length)} events match`
    : `${formatInt(items.length)} events`;

  return (
    <Panel title="Activity" icon={Activity} aside={status}>
      {rhy && rhy.t.length >= 2 ? <RhythmChart rhythm={rhy} on={on} /> : null}

      <div className="wl-afilters">
        <fieldset className="wl-afilters__chips">
          <legend className="ui-sr-only">Kinds of event</legend>
          {ACTIVITY_GROUPS.filter((g) => counts[g.id] > 0).map((g) => (
            <Chip key={g.id} selected={on.has(g.id)} onClick={() => toggle(g.id)}>
              {g.label}
              <span className="wl-afilters__n">{formatInt(counts[g.id])}</span>
            </Chip>
          ))}
        </fieldset>
        <SearchField
          size="sm"
          aria-label="Search the events"
          placeholder="Search by node, kind or words"
          value={text}
          onValueChange={(v) => {
            setText(v);
            setLimit(PAGE);
          }}
        />
        {filtered ? (
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear
          </Button>
        ) : null}
      </div>

      <p className="wl-note">{summary}</p>

      <Timeline
        // A new filter or page is not news: only an event that arrives while the list is as it is slides in.
        key={`${addr}|${[...on].sort().join()}|${needle}|${limit}`}
        items={timeline}
        live
        label="Events of this wallet's nodes, newest first"
        empty={
          <EmptyState
            compact
            icon={SearchX}
            title="No event matches"
            action={
              <Button size="sm" onClick={clear}>
                Clear the filters
              </Button>
            }
          >
            Nothing in these {formatInt(items.length)} events fits. Loosen the filters or the search.
          </EmptyState>
        }
      />

      {total > shown.length ? (
        <div className="wl-afeed__more">
          <Button size="sm" onClick={() => setLimit((l) => l + PAGE)}>
            Show {formatInt(Math.min(PAGE, total - shown.length))} more
          </Button>
          <span className="wl-note">
            {formatInt(shown.length)} of {formatInt(total)} shown
          </span>
        </div>
      ) : null}
      <p className="ui-sr-only" role="status">
        {status}
      </p>
    </Panel>
  );
}
