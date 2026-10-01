import { Search as SearchIcon, X } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { useRuntime } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import { useQueues } from '../sources/live';
import { type NodeHit, searchNodes } from '../sources/queueFeed';
import { TierGlyph, tierLabel } from '../ui';

/**
 * Find a node by id or part of its `ip:port`. A small combobox: arrow keys move through the matches,
 * Enter picks one, Escape closes. Each match says where the node stands in its queue.
 */
export function NodeSearch({ onPick }: { onPick: (hit: NodeHit) => void }) {
  const { store } = useRuntime();
  const queues = useQueues();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => searchNodes(store, queues, q, 8), [store, queues, q]);
  const show = open && q.trim().length >= 2;

  const pick = (h: NodeHit) => {
    onPick(h);
    setQ(h.endpoint);
    setOpen(false);
  };

  return (
    <div className="ix-q-search">
      <SearchIcon className="ix-q-search-i" size={15} strokeWidth={1.75} aria-hidden="true" />
      <input
        ref={input}
        className="ix-input"
        type="search"
        value={q}
        placeholder=" "
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-label="Find a node in the payment queues"
        aria-expanded={show}
        aria-controls={`${uid}-list`}
        aria-autocomplete="list"
        aria-activedescendant={show && hits[active] ? `${uid}-${active}` : undefined}
        onChange={(e) => {
          setQ(e.target.value);
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
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      <span className="ix-q-ph" aria-hidden="true">
        <span className="ix-q-ph-w">Find a node by IP, port or id</span>
        <span className="ix-q-ph-n">Find a node</span>
      </span>
      {q ? (
        <button
          type="button"
          className="ix-q-search-x"
          aria-label="Clear the search"
          onClick={() => {
            setQ('');
            setOpen(false);
            input.current?.focus();
          }}
        >
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : null}
      {show ? (
        <div className="ix-q-hits" id={`${uid}-list`} role="listbox" aria-label="Matching nodes">
          {hits.length === 0 ? (
            <div className="ix-q-hit" data-empty="">
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
                className="ix-q-hit"
                data-active={i === active || undefined}
                data-tier={h.tier}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(h);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <TierGlyph tier={h.tier} size={14} />
                <span className="ix-mono ix-q-hit-ep">{h.endpoint}</span>
                <span className="ix-dim">
                  {h.position === null
                    ? 'not queued'
                    : `${tierLabel(h.tier)} · #${formatInt(h.position + 1)} of ${formatInt(h.size)}`}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
