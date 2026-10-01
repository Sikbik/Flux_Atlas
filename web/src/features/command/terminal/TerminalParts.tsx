// The terminal's presentational pieces: an output line, the typed text with its block cursor, and the
// first-use introduction. No state of their own; the view feeds them.

import { type CSSProperties, memo, type ReactNode } from 'react';
import type { NavTarget } from '../navigation';
import type { OutLine, Span } from './output';

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

function SpanView({ span, onOpen }: { span: Span; onOpen: (to: NavTarget) => void }) {
  if (span.bar !== undefined) {
    return (
      <span
        className="term-bar"
        role="img"
        aria-label={span.t || 'Share'}
        style={{ '--f': span.bar } as CSSProperties}
      >
        <i />
      </span>
    );
  }
  const to = span.to;
  if (to) {
    return (
      <button type="button" className="term-link" data-s={span.s} onClick={() => onOpen(to)}>
        {span.t}
      </button>
    );
  }
  return <span data-s={span.s}>{span.t}</span>;
}

/** One output line. `old` lines were there when the terminal opened and do not animate in. */
export const LineView = memo(function LineView({
  line,
  old,
  onOpen,
}: {
  line: OutLine;
  old: boolean;
  onOpen: (to: NavTarget) => void;
}) {
  // A printed line never changes, so each span is keyed by where its text starts (empty fillers draw nothing).
  let at = 0;
  const spans: ReactNode[] = [];
  for (const s of line.spans) {
    const key = `${at}${s.bar === undefined ? 's' : 'b'}`;
    at += s.t.length;
    if (!s.t && s.bar === undefined) continue;
    spans.push(<SpanView key={key} span={s} onOpen={onOpen} />);
  }
  return (
    <div className="term-line" data-kind={line.kind} {...(old ? { 'data-old': '' } : {})}>
      {spans}
    </div>
  );
});

// ---------------------------------------------------------------------------------------------
// The typed line
// ---------------------------------------------------------------------------------------------

export type HeadState = 'typing' | 'known' | 'unknown';

interface Seg {
  id: 'head' | 'arg';
  text: string;
  cls: string;
}

/** The command word and the rest, so the word can be set apart as it is typed. */
function segments(value: string, head: HeadState): Seg[] {
  const m = /^(\s*\S+)([\s\S]*)$/.exec(value);
  if (!m) return [{ id: 'arg', text: value, cls: 'term-arg' }];
  const out: Seg[] = [{ id: 'head', text: m[1] ?? '', cls: `term-head term-head-${head}` }];
  if (m[2]) out.push({ id: 'arg', text: m[2], cls: 'term-arg' });
  return out;
}

/**
 * What the input shows: the text in colour, a block cursor on the character under the caret (inverted,
 * like a terminal), and the dim ghost completion after it. A transparent textarea sits over this and
 * takes the keys, so selection, IME and paste are the browser's own.
 */
export function Typed({
  value,
  caret,
  selecting,
  focused,
  ghost,
  head,
}: {
  value: string;
  caret: number;
  selecting: boolean;
  focused: boolean;
  ghost: string;
  head: HeadState;
}) {
  const pos = Math.max(0, Math.min(caret, value.length));
  const nodes: ReactNode[] = [];
  let placed = false;
  let off = 0;
  // The key restarts the blink, so the cursor is solid while you type or move it.
  const cursor = (ch: string) => (
    <span
      key={`cursor-${pos}-${value.length}`}
      className="term-cursor"
      data-focused={focused ? '' : undefined}
    >
      {ch || ' '}
    </span>
  );
  segments(value, head).forEach((seg) => {
    const start = off;
    const end = off + seg.text.length;
    off = end;
    if (selecting || placed || pos < start || pos >= end) {
      nodes.push(
        <span key={`${seg.id}-s`} className={seg.cls}>
          {seg.text}
        </span>,
      );
      return;
    }
    placed = true;
    const at = pos - start;
    nodes.push(
      <span key={`${seg.id}-a`} className={seg.cls}>
        {seg.text.slice(0, at)}
      </span>,
      cursor(seg.text[at] ?? ''),
      <span key={`${seg.id}-b`} className={seg.cls}>
        {seg.text.slice(at + 1)}
      </span>,
    );
  });
  if (!placed && !selecting) nodes.push(cursor(''));
  return (
    <div className="term-mirror" aria-hidden="true">
      {nodes}
      {ghost && pos >= value.length ? <span className="term-ghost">{ghost}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// First use
// ---------------------------------------------------------------------------------------------

export function Intro({ tries, onTry }: { tries: readonly string[]; onTry: (cmd: string) => void }) {
  return (
    <div className="term-intro">
      <p className="term-intro-title">
        Atlas shell <b>2.0</b>
      </p>
      <p className="term-intro-sub">Type a command, or press Tab to complete. A few places to start:</p>
      {/* biome-ignore lint/a11y/useSemanticElements: a row of buttons; a fieldset is for form controls */}
      <div className="term-tries" role="group" aria-label="Commands to try">
        {tries.map((t) => (
          <button key={t} type="button" className="term-try" onClick={() => onTry(t)}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
