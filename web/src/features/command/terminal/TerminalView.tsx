// The terminal window (design 8.7, 9.8): a real prompt over the same verbs as the interface. The look is
// a shell (block cursor, ghost completion, history, ^C, streams); the behaviour is Atlas (a node line
// opens the node beside it, `goto` flies the real camera). Output is plain data (output.ts), so the
// commands can be tested without any of this.
//
// Input: a transparent textarea over a mirror. The textarea takes the keys, so selection, IME, paste and
// mobile keyboards are the browser's; the mirror draws the coloured text, the block cursor and the
// ghost completion in Plex Mono, so they line up by construction.

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { ChevronDown, Square } from 'lucide-react';
import {
  type ClipboardEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useRuntime } from '../../../app/context';
import { useGlobeHandles } from '../../../globe';
import { windowId } from '../../../shell/wm/machine';
import { useWmDispatch } from '../../../shell/wm/react';
import { Button, Kbd, KbdCombo, LiveDot } from '../../../ui';
import { track } from '../../achievements/events';
import { holdIdle } from '../../ambient/idle';
import { type NavTarget, navigateTo } from '../navigation';
import { findCommand } from './commands';
import { complete, ghostFor, wordStart } from './complete';
import { createEnv } from './env';
import { loadHistory, pushHistory } from './history';
import { live } from './live';
import { dim, echoSpans, type OutLine } from './output';
import { splitCommand } from './parse';
import { scrollback } from './scrollback';
import { execute, isStreaming } from './session';
import { type HeadState, Intro, LineView, Typed } from './TerminalParts';
import './terminal.css';

const STICK_PX = 48;
const MAX_CANDIDATES = 8;

/** The commands first-use buttons offer: they work on any network, so none names a specific app that may not exist. */
function useTries(): string[] {
  const { store } = useRuntime();
  return useMemo(() => {
    const top = [...store.appList()].sort((a, b) => b.instances_running - a.instances_running)[0];
    return [
      'help',
      'next',
      'block tip',
      top ? `app ${top.display_name}` : 'top countries',
      'moon',
      'ambient',
    ];
  }, [store]);
}

/** Groups lines so each command's output hangs under its own prompt line. */
function group(lines: readonly OutLine[]): OutLine[][] {
  const groups: OutLine[][] = [];
  for (const l of lines) {
    const last = groups[groups.length - 1];
    if (l.kind === 'cmd' || !last) groups.push([l]);
    else last.push(l);
  }
  return groups;
}

export default function TerminalView({ cmd }: { cmd?: string | undefined }) {
  const router = useRouter();
  const runtime = useRuntime();
  const queryClient = useQueryClient();
  const handles = useGlobeHandles();
  const tries = useTries();
  const lines = useSyncExternalStore(scrollback.subscribe, scrollback.get, scrollback.get);

  // The line being typed and the running command outlive this instance (see live.ts).
  const start = cmd ?? live.getDraft();
  const [value, setValue] = useState(start);
  const [sel, setSel] = useState<{ a: number; b: number }>({ a: start.length, b: start.length });
  const [focused, setFocused] = useState(false);
  const [cands, setCands] = useState<string[]>([]);
  const running = useSyncExternalStore(live.subscribe, live.running, live.running);
  const [away, setAway] = useState(false);

  const history = useRef<string[]>(loadHistory());
  const walk = useRef<{ i: number; draft: string } | null>(null);
  const stick = useRef(true);
  const caretTo = useRef<number | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // Lines already on screen when the window opens do not animate in.
  const mountedAt = useRef(lines[lines.length - 1]?.id ?? 0);

  const engine = useCallback(() => handles.engine.get(), [handles]);
  const dispatch = useWmDispatch();
  const focusInput = useCallback(() => area.current?.focus({ preventScroll: true }), []);

  // A command that opens a window moves the route's primary window; the terminal rides in `?w=` and would
  // sit behind it. Once the route has settled, bring the terminal back to the front so it stays usable.
  const keepInFront = useCallback(() => {
    // The window may remount while the route changes: whichever instance exists next takes the keyboard.
    live.wantFocus();
    const off = router.subscribe('onResolved', () => {
      off();
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          dispatch({ t: 'focus', id: windowId('terminal', null) });
          // The new window may have taken the keyboard: hand it back to the prompt.
          if (!window.matchMedia?.('(pointer: coarse)').matches) focusInput();
        }),
      );
    });
  }, [router, dispatch, focusInput]);

  const completionEnv = useMemo(
    () => createEnv({ router, runtime, queryClient, engine, signal: new AbortController().signal }),
    [router, runtime, queryClient, engine],
  );

  const open = useCallback(
    (to: NavTarget) => {
      navigateTo(router, to, 'keepTerminal');
      keepInFront();
    },
    [router, keepInFront],
  );

  // ---- caret and value ------------------------------------------------------------------------

  const syncCaret = useCallback(() => {
    const el = area.current;
    if (!el) return;
    setSel((cur) =>
      cur.a === el.selectionStart && cur.b === el.selectionEnd
        ? cur
        : { a: el.selectionStart, b: el.selectionEnd },
    );
  }, []);

  /** Replaces the line and puts the caret at `at` (the end by default) once it has rendered. */
  const put = useCallback((next: string, at?: number) => {
    const pos = at ?? next.length;
    caretTo.current = pos;
    live.setDraft(next);
    setValue(next);
    setSel({ a: pos, b: pos });
    setCands([]);
  }, []);

  useLayoutEffect(() => {
    const el = area.current;
    const at = caretTo.current;
    if (el && at !== null) {
      el.setSelectionRange(at, at);
      caretTo.current = null;
    }
  });

  // A prefilled `?cmd=` fills the line and never runs it.
  useEffect(() => {
    if (cmd) put(cmd);
  }, [cmd, put]);

  // This instance is on screen: a pending stop of a running stream is cancelled; when it goes, the stream
  // stops unless another instance takes over within a moment.
  useEffect(() => {
    live.attach();
    return () => live.detach();
  }, []);

  useEffect(() => {
    if (window.matchMedia?.('(pointer: coarse)').matches) return;
    focusInput();
    if (!live.focusWanted()) return;
    // A command just opened a window beside the terminal, which may take the keyboard while it settles.
    const timers = [120, 400, 900].map((ms) => window.setTimeout(focusInput, ms));
    return () => {
      for (const t of timers) window.clearTimeout(t);
    };
  }, [focusInput]);

  // ---- scrolling ------------------------------------------------------------------------------

  useLayoutEffect(() => {
    const el = screen.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const onScroll = useCallback(() => {
    const el = screen.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
    stick.current = near;
    setAway(!near);
  }, []);

  const toLatest = useCallback(() => {
    const el = screen.current;
    if (!el) return;
    stick.current = true;
    el.scrollTop = el.scrollHeight;
    setAway(false);
    focusInput();
  }, [focusInput]);

  // ---- running --------------------------------------------------------------------------------

  const submit = useCallback(
    async (raw: string) => {
      const line = raw.trim();
      if (!line || live.running()) return;
      stick.current = true;
      scrollback.push('cmd', echoSpans(line));
      history.current = pushHistory(history.current, line);
      walk.current = null;
      put('');
      const { name } = splitCommand(line);
      const streaming = isStreaming(line);
      const ac = live.start({ name, streaming });
      const release = streaming ? holdIdle() : null;
      if (streaming) track({ type: 'terminal', name, ok: true, streams: true });
      try {
        const env = createEnv({
          router,
          runtime,
          queryClient,
          engine,
          signal: ac.signal,
          onOpened: keepInFront,
        });
        const res = await execute(line, env, scrollback);
        if (!res.streams && res.name) track({ type: 'terminal', name: res.name, ok: res.ok, streams: false });
      } finally {
        release?.();
        if (streaming && ac.signal.aborted) scrollback.push('sys', [dim('^C')]);
        live.stop();
        window.requestAnimationFrame(() => {
          if (!window.matchMedia?.('(pointer: coarse)').matches) focusInput();
        });
      }
    },
    [router, runtime, queryClient, engine, keepInFront, put, focusInput],
  );

  const interrupt = useCallback(() => {
    if (live.interrupt()) return;
    // A typed line is abandoned, like a shell: it stays on screen with ^C after it.
    if (value) {
      scrollback.push('cmd', [...echoSpans(value), dim('^C')]);
      stick.current = true;
    }
    put('');
  }, [value, put]);

  // ---- completion and history -----------------------------------------------------------------

  const ghost = useMemo(() => (running ? '' : ghostFor(value, history.current)), [value, running]);
  const atEnd = sel.a === sel.b && sel.b >= value.length;

  const tab = useCallback(() => {
    if (running) return;
    if (ghost && atEnd) {
      put(value + ghost);
      return;
    }
    const r = complete(value, completionEnv);
    if (r.line !== value) put(r.line);
    setCands(r.candidates);
  }, [running, ghost, atEnd, value, put, completionEnv]);

  const pick = useCallback(
    (candidate: string) => {
      const head = value.slice(0, wordStart(value));
      put(`${head}${/\s/.test(candidate) ? `"${candidate}"` : candidate} `);
      focusInput();
    },
    [value, put, focusInput],
  );

  const stepHistory = useCallback(
    (dir: -1 | 1) => {
      const list = history.current;
      if (list.length === 0) return;
      const cur = walk.current ?? { i: list.length, draft: value };
      const i = Math.max(0, Math.min(list.length, cur.i + dir));
      if (i >= list.length) {
        walk.current = null;
        put(cur.draft);
        return;
      }
      walk.current = { i, draft: cur.draft };
      put(list[i] ?? '');
    },
    [value, put],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing) return;
      const mod = e.ctrlKey || e.metaKey;
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          if (!e.shiftKey) void submit(value);
          return;
        case 'Tab':
          if (e.shiftKey) return;
          e.preventDefault();
          tab();
          return;
        case 'ArrowUp':
          if (mod || e.altKey) return;
          e.preventDefault();
          stepHistory(-1);
          return;
        case 'ArrowDown':
          if (mod || e.altKey) return;
          e.preventDefault();
          stepHistory(1);
          return;
        case 'ArrowRight':
        case 'End':
          if (ghost && atEnd && !mod) {
            e.preventDefault();
            put(value + ghost);
          }
          return;
        case 'Escape':
          if (cands.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            setCands([]);
          }
          return;
        default:
      }
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'c' && sel.a === sel.b) {
        e.preventDefault();
        interrupt();
      } else if (k === 'l') {
        e.preventDefault();
        scrollback.clear();
      } else if (k === 'u') {
        e.preventDefault();
        put(value.slice(sel.b), 0);
      }
    },
    [submit, value, tab, stepHistory, ghost, atEnd, put, cands.length, sel, interrupt],
  );

  // Soft keyboards send a line break instead of a key: that is Enter too.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onBefore = (ev: InputEvent) => {
      if (ev.inputType === 'insertLineBreak' || ev.inputType === 'insertParagraph') {
        ev.preventDefault();
        void submit(el.value);
      }
    };
    el.addEventListener('beforeinput', onBefore);
    return () => el.removeEventListener('beforeinput', onBefore);
  }, [submit]);

  const onPaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
    // Only the first line of a multi-line paste is kept: a paste never runs anything.
    const text = e.clipboardData.getData('text');
    if (!/[\r\n]/.test(text)) return;
    e.preventDefault();
    const el = e.currentTarget;
    const joined = text.split(/\r?\n/).filter(Boolean).join(' ');
    el.setRangeText(joined, el.selectionStart, el.selectionEnd, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, []);

  const tryCommand = useCallback(
    (c: string) => {
      void submit(c);
    },
    [submit],
  );

  // ---- render ---------------------------------------------------------------------------------

  const groups = useMemo(() => group(lines), [lines]);
  const word = value.trim().split(/\s+/)[0] ?? '';
  const head: HeadState = findCommand(word) ? 'known' : /\s/.test(value.trim()) ? 'unknown' : 'typing';
  const state = running ? (running.streaming ? 'streaming' : 'running') : 'idle';

  return (
    <section
      className="term"
      data-state={state}
      data-focused={focused ? '' : undefined}
      aria-label="Terminal"
      onPointerUp={(e) => {
        // A click on the screen focuses the prompt, unless it ended a text selection.
        if (e.target instanceof Element && e.target.closest('button, a')) return;
        if (window.getSelection()?.toString()) return;
        focusInput();
      }}
    >
      <h2 className="term-sr">Terminal</h2>
      <div className="term-screen" ref={screen} onScroll={onScroll}>
        {lines.length === 0 ? <Intro tries={tries} onTry={tryCommand} /> : null}

        <div
          className="term-log"
          role="log"
          aria-label="Terminal output"
          aria-relevant="additions"
          data-fx-density="dense"
        >
          {groups.map((g, gi) => (
            <div
              key={g[0]?.id}
              className="term-group"
              data-latest={gi === groups.length - 1 ? '' : undefined}
            >
              {g.map((l) => (
                <LineView key={l.id} line={l} old={l.id <= mountedAt.current} onOpen={open} />
              ))}
            </div>
          ))}
        </div>

        {running?.streaming ? (
          <div className="term-live" role="status">
            <LiveDot status="ok" />
            <span className="term-live-text">
              Following.
              <span className="term-live-hint">
                {' '}
                <KbdCombo keys={['ctrl', 'C']} /> stops it.
              </span>
            </span>
            <Button className="term-stop" size="sm" pill icon={Square} onClick={interrupt}>
              Stop
            </Button>
          </div>
        ) : null}

        {/* The prompt stays mounted while a stream runs (hidden), so the keyboard, and Ctrl+C, still land in it. */}
        <div
          className="term-prompt"
          data-running={running ? '' : undefined}
          data-hidden={running?.streaming ? '' : undefined}
        >
          <span className="term-ps1" aria-hidden="true">
            <span className="term-ps1-who">atlas@flux</span> <span className="term-ps1-dir">~</span>
          </span>
          <div className="term-edit">
            <Typed
              value={value}
              caret={sel.b}
              selecting={sel.a !== sel.b}
              focused={focused}
              ghost={ghost}
              head={head}
            />
            <textarea
              ref={area}
              className="term-input"
              value={value}
              rows={1}
              aria-label="Terminal command"
              aria-autocomplete="list"
              enterKeyHint="go"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              readOnly={running !== null}
              onChange={(e) => {
                walk.current = null;
                const next = e.target.value.replace(/\r?\n/g, ' ');
                live.setDraft(next);
                setValue(next);
                setCands([]);
                syncCaret();
              }}
              onKeyDown={onKeyDown}
              onKeyUp={syncCaret}
              onSelect={syncCaret}
              onClick={syncCaret}
              onPaste={onPaste}
              onFocus={() => {
                setFocused(true);
                syncCaret();
              }}
              onBlur={() => setFocused(false)}
            />
          </div>
          {running ? <span className="term-spin" role="status" aria-label="Running" /> : null}
          <button
            type="button"
            className="term-tabkey"
            onClick={tab}
            tabIndex={-1}
            aria-label="Complete (Tab)"
          >
            <Kbd aria-hidden="true">Tab</Kbd>
          </button>
        </div>

        {cands.length > 0 ? (
          <div className="term-cands" role="listbox" aria-label="Completions">
            {cands.slice(0, MAX_CANDIDATES).map((c) => (
              <button
                key={c}
                type="button"
                role="option"
                aria-selected="false"
                className="term-cand"
                onClick={() => pick(c)}
              >
                {c}
              </button>
            ))}
            {cands.length > MAX_CANDIDATES ? (
              <span className="term-cands-more">+{cands.length - MAX_CANDIDATES} more</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {away ? (
        <Button className="term-jump" size="sm" pill icon={ChevronDown} onClick={toLatest}>
          Latest
        </Button>
      ) : null}
    </section>
  );
}

export { TerminalView };
