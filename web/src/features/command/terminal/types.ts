// The terminal's contracts: what a command can print, what it can touch, and how it is described to
// `help` and to completion. Commands never import the router, the engine or React: they receive a
// `CmdEnv`, so each one can be run in a test against a fake and read back what it printed.

import type { BlockLite } from '../../../api/generated/BlockLite';
import type { SearchHit } from '../../../api/generated/SearchHit';
import type { BeatState } from '../../../lib/clock';
import type { NetworkStore } from '../../../store/network';
import type { NavTarget } from '../navigation';
import type { ActionEnv } from '../palette/actions';
import type { FlyView } from '../palette/types';
import type { Span, SpanInput } from './output';

export interface Io {
  /** An output line from spans (plain strings are unstyled text). */
  line(...spans: SpanInput[]): void;
  /** Several lines at once. */
  lines(rows: Span[][]): void;
  /** A dim line: hints, "what next". */
  hint(text: string): void;
  /** An error in words, with what to try. */
  err(text: string, tryThis?: string): void;
  blank(): void;
}

export interface CmdEnv {
  store: NetworkStore;
  /** Server-corrected unix ms. */
  now(): number;
  beat(): BeatState;
  /** Aborted by Ctrl+C or when the terminal closes; streams end when it fires. */
  signal: AbortSignal;
  /** The current route's path and search params. */
  location(): { pathname: string; search: Record<string, unknown> };
  /** What the action catalogue needs to describe the app right now (search results use it). */
  actionEnv(): ActionEnv;
  /** Opens a window or page, keeping the terminal open beside it. */
  open(target: NavTarget): void;
  /** Flies the camera; false when there is no globe. */
  fly(view: FlyView): boolean;
  /** Runs a shared action by id (layers, filters, art style, ambient). */
  action(id: string, arg?: string): void;
  /** The server's search hits for a text. */
  searchHits(q: string): Promise<readonly SearchHit[]>;
  /** A block by height or hash from the API; null when it does not exist. */
  fetchBlock(key: string | number): Promise<BlockLite | null>;
  /** Replays the last block's relay on the globe; false when there is nothing to replay. */
  replayRelay(): boolean;
  /** Watches or stops watching a node by id. */
  watch(id: number, on: boolean): void;
  watched(): readonly number[];
  /** The achievement summary for the `achievements` command. */
  achievementLines(): Span[][];
  version: string;
}

export type CommandLevel = 'core' | 'more' | 'hidden';

export interface Command {
  name: string;
  usage: string;
  summary: string;
  /** `core` commands appear in `help`; `more` ones in `help all`; `hidden` ones only by name. */
  level: CommandLevel;
  /** Extra lines for `help <command>`. */
  detail?: readonly string[];
  /** Examples shown by `help <command>`. */
  examples?: readonly string[];
  /** Runs until interrupted. */
  streams?: boolean;
  run(args: string[], rest: string, env: CmdEnv, io: Io): void | Promise<void>;
  /** Candidates for the word being typed (`words` are the arguments before it, `partial` the word itself). */
  complete?(words: string[], partial: string, env: CmdEnv): string[];
}
