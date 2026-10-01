// Running a typed line: finds the command, gives it an `Io` that prints into the scrollback, and reports
// how it went. Free of React and of the router, so the whole path from text to output is testable with a
// fake environment and an array for a screen.

import { classifyText } from '../palette/model';
import { findCommand } from './commands';
import { nearest } from './complete';
import { asSpan, dim, type LineKind, type Span, type SpanInput, sp } from './output';
import { splitCommand } from './parse';
import type { CmdEnv, Command, Io } from './types';

/** Where output goes: the scrollback in the app, an array in tests. */
export interface Sink {
  push(kind: LineKind, spans: Span[]): unknown;
  pushMany(kind: LineKind, rows: Span[][]): void;
  clear(): void;
}

export interface TrackedIo extends Io {
  /** True once the command reported an error. */
  failed(): boolean;
  /** Lines printed so far. */
  printed(): number;
}

export function makeIo(sink: Sink): TrackedIo {
  let failed = false;
  let printed = 0;
  return {
    line: (...spans: SpanInput[]) => {
      printed++;
      sink.push('out', spans.map(asSpan));
    },
    lines: (rows) => {
      printed += rows.length;
      sink.pushMany('out', rows);
    },
    hint: (text) => {
      printed++;
      sink.push('hint', [dim(text)]);
    },
    err: (text, tryThis) => {
      failed = true;
      printed++;
      sink.push('err', [sp(text, 'crit')]);
      if (tryThis) sink.push('hint', [dim(tryThis)]);
    },
    blank: () => {
      printed++;
      sink.push('out', [sp('')]);
    },
    failed: () => failed,
    printed: () => printed,
  };
}

export interface ExecResult {
  /** The command that ran (the inferred one for a bare IP or height). */
  name: string;
  ok: boolean;
  /** The command streams until interrupted. */
  streams: boolean;
}

/** A bare IP, height or address is a question about that thing: answer it as the matching command. */
export function inferLine(line: string): { line: string; note: string } | null {
  const shape = classifyText(line);
  switch (shape.kind) {
    case 'ip':
      return { line: `node ${line.trim()}`, note: 'node' };
    case 'height':
      return { line: `block ${shape.height}`, note: 'block' };
    case 'hash':
    case 'outpoint':
    case 'shielded':
      return { line: `search ${line.trim()}`, note: 'search' };
    case 'address':
      return { line: `addr ${line.trim()}`, note: 'addr' };
    default:
      return null;
  }
}

/** True when the command is going to stream (so the view can show its running state at once). */
export function isStreaming(line: string): boolean {
  const { name } = splitCommand(line);
  return findCommand(name)?.streams === true;
}

/** Runs one line. Never throws: a command's failure is printed as an error line. */
export async function execute(line: string, env: CmdEnv, sink: Sink): Promise<ExecResult> {
  const io = makeIo(sink);
  let parsed = splitCommand(line);
  if (!parsed.name) return { name: '', ok: true, streams: false };
  if (parsed.name === 'clear') {
    sink.clear();
    return { name: 'clear', ok: true, streams: false };
  }
  let cmd: Command | undefined = findCommand(parsed.name);
  if (!cmd) {
    const inferred = inferLine(line.trim());
    if (inferred) {
      io.hint(`Reading that as ${inferred.note}.`);
      parsed = splitCommand(inferred.line);
      cmd = findCommand(parsed.name);
    }
  }
  if (!cmd) {
    const guess = nearest(parsed.name);
    io.err(
      `Unknown command '${parsed.name}'.${guess ? ` Did you mean ${guess}?` : ''}`,
      'Type help to see what is available.',
    );
    return { name: parsed.name, ok: false, streams: false };
  }
  try {
    await cmd.run(parsed.args, parsed.rest, env, io);
  } catch (e) {
    if (!env.signal.aborted)
      io.err(
        `${cmd.name} did not work: ${e instanceof Error ? e.message : String(e)}`,
        'Try it again in a moment.',
      );
  }
  return { name: cmd.name, ok: !io.failed(), streams: cmd.streams === true };
}
