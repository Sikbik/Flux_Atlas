import { useId, useMemo, useState } from 'react';
import { useRuntime } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import { SearchField, TierGlyph, tierLabel } from '../../../ui';
import { useQueues } from '../sources/live';
import { type NodeHit, searchNodes } from '../sources/queueFeed';
import './find.css';

/**
 * Find a node by id or part of its `ip:port`. A search field with a list of matches under it: arrow
 * keys move through the matches, Enter picks one, Escape closes. Each match says where the node stands
 * in its payment queue. The kit has a search field but no combobox, so the list is local.
 */
export function NodeFinder({
  onPick,
  label = 'Find a node',
  placeholder = 'IP, port or node id',
  note,
  keepText = true,
}: {
  onPick: (hit: NodeHit) => void;
  label?: string;
  placeholder?: string;
  /** A second piece of text on the right of a match (for example "Watching"). */
  note?: (hit: NodeHit) => string | null;
  /** Leave the picked node's address in the field (a selection), or clear it (an addition). */
  keepText?: boolean;
}) {
  const { store } = useRuntime();
  const queues = useQueues();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const uid = useId();

  const hits = useMemo(() => searchNodes(store, queues, q, 8), [store, queues, q]);
  const show = open && q.trim().length >= 2;

  const pick = (h: NodeHit) => {
    onPick(h);
    setQ(keepText ? h.endpoint : '');
    setOpen(false);
  };

  return (
    <div className="ix-find">
      <SearchField
        size="sm"
        value={q}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={show}
        aria-controls={`${uid}-list`}
        aria-autocomplete="list"
        aria-activedescendant={show && hits[active] ? `${uid}-${active}` : undefined}
        spellCheck={false}
        onValueChange={(v) => {
          setQ(v);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(hits.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            const h = hits[active];
            if (h) {
              e.preventDefault();
              pick(h);
            }
          } else if (e.key === 'Escape' && show) {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      {show ? (
        <div className="ix-find-hits" id={`${uid}-list`} role="listbox" aria-label="Matching nodes">
          {hits.length === 0 ? (
            <div className="ix-find-hit" data-empty="">
              No node matches {q.trim()}
            </div>
          ) : (
            hits.map((h, i) => (
              // biome-ignore lint/a11y/useFocusableInteractive: the input keeps focus; options follow aria-activedescendant
              <div
                key={h.id}
                id={`${uid}-${i}`}
                role="option"
                aria-selected={i === active}
                className="ix-find-hit"
                data-active={i === active || undefined}
                data-tier={h.tier}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(h);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <TierGlyph tier={h.tier} size={14} />
                <span className="ui-mono ix-find-ep">{h.endpoint}</span>
                <span className="ix-find-note">
                  {note?.(h) ??
                    (h.position === null
                      ? 'not queued'
                      : `${h.tier === 'unknown' ? 'Unknown tier' : tierLabel(h.tier)} · #${formatInt(h.position + 1)} of ${formatInt(h.size)}`)}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
