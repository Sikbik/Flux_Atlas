// A read-only JSON view: keys, strings, numbers and literals in their own tones, with a copy button.
// Used for the "Raw" tab: the record exactly as the server sent it. A long record shows its first lines
// and offers the rest on request; the copy button always carries all of it.

import { type ReactNode, useMemo, useState } from 'react';
import { formatInt } from '../../../lib/format';
import { Button, CopyButton } from '../../../ui';
import './json.css';

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Lines shown before the reader asks for the rest: enough to read, light enough to paint at once. */
const FIRST_LINES = 400;

function highlight(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) {
      out.push(
        m[2] !== undefined ? (
          <span key={k++} className="ex-json__key">
            {m[1]}
          </span>
        ) : (
          <span key={k++} className="ex-json__str">
            {m[1]}
          </span>
        ),
      );
      if (m[2] !== undefined) out.push(m[2]);
    } else if (m[3] !== undefined) {
      out.push(
        <span key={k++} className="ex-json__lit">
          {m[3]}
        </span>,
      );
    } else if (m[4] !== undefined) {
      out.push(
        <span key={k++} className="ex-json__num">
          {m[4]}
        </span>,
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function JsonView({ value, label }: { value: unknown; label: string }) {
  const text = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const [all, setAll] = useState(false);
  const lines = useMemo(() => text.split('\n'), [text]);
  const clipped = lines.length > FIRST_LINES && !all;
  const shown = useMemo(
    () => (clipped ? lines.slice(0, FIRST_LINES).join('\n') : text),
    [clipped, lines, text],
  );
  const body = useMemo(() => highlight(shown), [shown]);
  return (
    <figure className="ex-json" aria-label={label}>
      <div className="ex-json__bar">
        <span>
          {label}
          {clipped ? (
            <span className="ex-json__count">
              {' '}
              first {formatInt(FIRST_LINES)} of {formatInt(lines.length)} lines
            </span>
          ) : null}
        </span>
        <span className="ex-json__tools">
          {clipped ? (
            <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
              Show all
            </Button>
          ) : null}
          <CopyButton value={text} what="JSON" />
        </span>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable so the keyboard can scroll it */}
      <pre className="ex-json__pre" tabIndex={0}>
        <code>{body}</code>
      </pre>
    </figure>
  );
}
