// The command palette: one text field that finds things (nodes, hosts, providers, apps, blocks,
// transactions, addresses, places) and runs actions, with the keyboard first.
//
// What makes it feel instant: matches from the NetworkStore appear on the first keystroke and the
// server's hits slide in behind them; the highlight is one element that glides between rows; the list
// height eases instead of jumping; and a hash pasted before the server answers is still opened by Enter
// (the palette waits for the answer and then goes to the best hit).

import { useRouter } from '@tanstack/react-router';
import { Info, Search, SearchX } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNetwork, useRuntime } from '../../../app/context';
import { useGlobeHandles } from '../../../globe';
import { EmptyState } from '../../../ui';
import { track } from '../../achievements/events';
import { hasMod } from '../keys';
import { writePaletteText } from '../paletteUrl';
import { drainTypeAhead } from '../typeAhead';
import { KindStrip } from './KindStrip';
import { loadRecents } from './recents';
import { KeyCap, optionId, RowSkeletons, RowView } from './rows';
import { type RunCtx, type RunMode, runRow } from './run';
import { KIND_CHIPS, type KindChip, type PaletteRow, type Prefix } from './types';
import { type ServerState, useSearchModel } from './useSearchModel';
import './palette.css';

export interface PaletteProps {
  phase: 'open' | 'closing';
  /** The text the URL carries (the palette's own text is authoritative while it is open). */
  urlText: string | null;
  /**
   * Reads the text typed into the stand-in panel before this chunk arrived. It is a function because the
   * host's render happened before that typing: only reading at mount sees what was typed.
   */
  seed: () => string;
  /** Closes the palette (the host decides how history moves). */
  close: () => void;
  /** Opens the palette from a key press (tells the achievements). */
  via: 'key' | 'url';
}

const URL_WRITE_MS = 220;
const PAGE_ROWS = 6;

const PLACEHOLDER = 'Search nodes, apps, blocks, addresses, or type a command';

export default function Palette({ phase, urlText, seed, close, via }: PaletteProps) {
  const router = useRouter();
  const { store, effects } = useRuntime();
  const handles = useGlobeHandles();
  const loaded = useNetwork((s) => s.loaded);

  const [raw, setRaw] = useState(() => seed() || (urlText ?? ''));
  const [chip, setChip] = useState<KindChip>('all');
  const [recents] = useState(() => loadRecents());
  const [userActive, setUserActive] = useState<string | null>(null);
  const [pending, setPending] = useState<RunMode | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const lastWritten = useRef<string | null>(urlText);
  const lastModel = useRef<unknown>(null);

  const { model, server } = useSearchModel({ raw, chip, recents });
  const text = model.input.text;

  const flat = useMemo<PaletteRow[]>(() => {
    const rows = model.groups.flatMap((g) => g.rows);
    return model.seeAll ? [...rows, model.seeAll] : rows;
  }, [model]);

  const activeId =
    userActive !== null && flat.some((r) => r.id === userActive) ? userActive : (model.best?.id ?? null);
  const active = useMemo(() => flat.find((r) => r.id === activeId) ?? null, [flat, activeId]);

  // ---- running rows ---------------------------------------------------------------------------

  const ctx = useMemo<RunCtx>(
    () => ({ router, store, effects, engine: () => handles.engine.get(), dismiss: close }),
    [router, store, effects, handles, close],
  );

  const focusInput = useCallback((at?: number) => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const n = at ?? el.value.length;
    el.setSelectionRange(n, n);
  }, []);

  const activate = useCallback(
    (row: PaletteRow, mode: RunMode) => {
      const res = runRow(row, mode, ctx);
      if (res.kind === 'text') {
        setRaw(res.text);
        setUserActive(null);
        setChip('all');
        window.requestAnimationFrame(() => focusInput());
      }
    },
    [ctx, focusInput],
  );

  // Enter before the server answered: wait for it, then go to the best hit.
  useEffect(() => {
    if (pending === null || server === 'loading') return;
    const row = model.best;
    setPending(null);
    if (row) activate(row, pending);
  }, [pending, server, model.best, activate]);

  // ---- URL text and focus ---------------------------------------------------------------------

  const readSeed = useRef(seed);
  readSeed.current = seed;
  useEffect(() => {
    // Text the stand-in took while this tree was ready but not yet swapped in (React holds a ready tree for
    // a moment so the stand-in does not flash, and the state above was set before those keys), and keys
    // typed before any field existed.
    const typed = readSeed.current();
    const early = drainTypeAhead();
    if (typed || early) setRaw((cur) => (typed || cur) + early);
    focusInput();
    if (typed || early) window.requestAnimationFrame(() => focusInput());
    track({ type: 'palette', action: 'open', via });
  }, [focusInput, via]);

  // Adopt text another surface wrote (a launcher setting `q=operator ` while the palette is open).
  useEffect(() => {
    if (urlText === null || urlText === lastWritten.current || urlText === raw) return;
    lastWritten.current = urlText;
    setRaw(urlText);
    setUserActive(null);
    window.requestAnimationFrame(() => focusInput());
  }, [urlText, raw, focusInput]);

  // Debounced write of the text into `q`: reload and share keep what was typed.
  useEffect(() => {
    if (phase !== 'open' || raw === lastWritten.current) return;
    const t = window.setTimeout(() => {
      lastWritten.current = raw;
      writePaletteText(router, raw);
    }, URL_WRITE_MS);
    return () => window.clearTimeout(t);
  }, [raw, phase, router]);

  // Escape closes at the capture phase, before the window manager's own Escape (which would close a window).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || phase !== 'open') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [close, phase]);

  // ---- list geometry: height, highlight, scroll -----------------------------------------------

  useLayoutEffect(() => {
    const sizer = sizerRef.current;
    const list = listRef.current;
    if (!sizer || !list) return;
    let first = true;
    const apply = () => {
      list.style.setProperty('--pal-list-h', `${Math.ceil(sizer.getBoundingClientRect().height)}px`);
      if (first) {
        first = false;
        window.requestAnimationFrame(() => list.setAttribute('data-ready', ''));
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(sizer);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    const sizer = sizerRef.current;
    const hl = hlRef.current;
    if (!list || !sizer || !hl) return;
    const el = activeId ? sizer.querySelector<HTMLElement>(`[id="${optionId(activeId)}"]`) : null;
    if (!el) {
      hl.style.opacity = '0';
      return;
    }
    const modelChanged = lastModel.current !== model;
    lastModel.current = model;
    if (modelChanged) hl.style.transition = 'none';
    hl.style.opacity = '1';
    hl.style.height = `${el.offsetHeight}px`;
    hl.style.transform = `translateY(${el.offsetTop}px)`;
    if (modelChanged) {
      void hl.offsetHeight;
      window.requestAnimationFrame(() => {
        hl.style.transition = '';
      });
    }
    // Scroll the row into view (and its group heading when it is the group's first row).
    const group = el.closest<HTMLElement>('[role="group"]');
    const isFirst = group?.querySelector('[role="option"]') === el;
    const top = isFirst && group ? group.offsetTop : el.offsetTop;
    const bottom = el.offsetTop + el.offsetHeight + 14;
    const viewH = Math.min(sizer.offsetHeight, list.clientHeight || sizer.offsetHeight);
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 4);
    else if (bottom > list.scrollTop + viewH) list.scrollTop = bottom - viewH;
  }, [activeId, model]);

  // Fades at the list edges only where there is more to scroll.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => {
      list.toggleAttribute('data-fade-top', list.scrollTop > 2);
      list.toggleAttribute('data-fade-bottom', list.scrollHeight - list.scrollTop - list.clientHeight > 2);
    };
    update();
    list.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(list);
    if (sizerRef.current) ro.observe(sizerRef.current);
    return () => {
      list.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  // ---- keyboard -------------------------------------------------------------------------------

  const move = useCallback(
    (delta: number, absolute = false) => {
      if (flat.length === 0) return;
      const cur = flat.findIndex((r) => r.id === activeId);
      let next = absolute ? (delta < 0 ? flat.length - 1 : 0) : cur + delta;
      if (!absolute) {
        // Paging stops at the ends; single steps wrap around.
        if (Math.abs(delta) > 1) next = Math.max(0, Math.min(flat.length - 1, next));
        else next = (next + flat.length) % flat.length;
      }
      const row = flat[next];
      if (row) setUserActive(row.id);
    },
    [flat, activeId],
  );

  const cycleChip = useCallback(
    (dir: 1 | -1) => {
      const i = KIND_CHIPS.findIndex((k) => k.id === chip);
      const n = KIND_CHIPS[(i + dir + KIND_CHIPS.length) % KIND_CHIPS.length];
      if (n) {
        setChip(n.id);
        setUserActive(null);
      }
    },
    [chip],
  );

  const ghost = useMemo(() => {
    if (model.input.prefix || !raw || !model.best || userActive !== null) return '';
    const t = model.best.title;
    return t.length > raw.length && t.toLowerCase().startsWith(raw.toLowerCase()) ? t.slice(raw.length) : '';
  }, [model, raw, userActive]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const key = e.key;
    if (key === 'ArrowDown' || (e.ctrlKey && key.toLowerCase() === 'n')) {
      e.preventDefault();
      move(1);
    } else if (key === 'ArrowUp' || (e.ctrlKey && key.toLowerCase() === 'p')) {
      e.preventDefault();
      move(-1);
    } else if (key === 'PageDown') {
      e.preventDefault();
      move(PAGE_ROWS);
    } else if (key === 'PageUp') {
      e.preventDefault();
      move(-PAGE_ROWS);
    } else if ((key === 'Home' || key === 'End') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      move(key === 'Home' ? 1 : -1, true);
    } else if (key === 'Tab') {
      e.preventDefault();
      if (!model.input.prefix) cycleChip(e.shiftKey ? -1 : 1);
    } else if (key === 'ArrowRight' && ghost && e.currentTarget.selectionStart === raw.length) {
      e.preventDefault();
      if (model.best) {
        setRaw(model.best.title);
        setUserActive(null);
      }
    } else if (key === 'Enter') {
      e.preventDefault();
      if (hasMod(e)) {
        if (text)
          void router.navigate({ to: '/q/$text', params: { text }, hash: 'all', replace: true } as never);
        return;
      }
      const mode: RunMode = e.altKey ? 'fly' : e.shiftKey ? 'alongside' : 'open';
      if (active) activate(active, mode);
      else if (server === 'loading') setPending(mode);
    }
  };

  const onPick = useCallback(
    (row: PaletteRow, e: React.MouseEvent) => {
      const mode: RunMode = e.altKey ? 'fly' : e.shiftKey ? 'alongside' : 'open';
      setUserActive(row.id);
      activate(row, mode);
    },
    [activate],
  );
  const onHover = useCallback((row: PaletteRow) => setUserActive(row.id), []);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRaw(e.target.value);
    setUserActive(null);
    setPending(null);
  };

  // ---- render ---------------------------------------------------------------------------------

  const showSkeleton = text !== '' && model.groups.length === 0 && server === 'loading';
  const showEmpty = model.empty && server !== 'loading';
  const chipLabel = KIND_CHIPS.find((k) => k.id === chip)?.label ?? 'All';
  const announce =
    text === '' ? '' : flat.length > 0 ? `${flat.length} results` : showEmpty ? 'No results' : '';

  return (
    <div
      className="pal-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Search and commands"
      data-phase={phase}
      data-has-text={text ? '' : undefined}
    >
      <div className="pal-in">
        <Search size={20} strokeWidth={1.9} className="pal-glass" aria-hidden="true" />
        <div className="pal-field">
          <input
            ref={inputRef}
            id="pal-input"
            className="pal-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-autocomplete="list"
            {...(activeId ? { 'aria-activedescendant': optionId(activeId) } : {})}
            aria-label="Search or run a command"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            inputMode="search"
            placeholder={PLACEHOLDER}
            value={raw}
            onChange={onChange}
            onKeyDown={onKeyDown}
          />
          {ghost ? (
            <div className="pal-ghost" aria-hidden="true">
              <span>{raw}</span>
              {ghost}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="pal-esc"
          onClick={close}
          aria-label="Close the palette"
          tabIndex={-1}
        >
          <KeyCap k="esc" />
        </button>
      </div>
      <div className="pal-sweep" data-on={server === 'loading' ? '' : undefined} aria-hidden="true" />

      {model.usage ? (
        <div className="pal-usage">
          <code>{model.usage}</code>
          <span>{model.input.text ? 'Enter runs the first match' : 'Type after the word to search'}</span>
        </div>
      ) : (
        <KindStrip
          chip={chip}
          counts={model.counts}
          showCounts={text !== ''}
          onPick={(id) => {
            setChip(id);
            setUserActive(null);
            inputRef.current?.focus();
          }}
        />
      )}

      {server === 'error' ? (
        <div className="pal-banner" role="status">
          <Info size={14} aria-hidden="true" />
          Could not reach search. Showing local results.
        </div>
      ) : !loaded && text ? (
        <div className="pal-banner" data-tone="info" role="status">
          <Info size={14} aria-hidden="true" />
          The network is still loading. Matches fill in as nodes arrive.
        </div>
      ) : null}

      <div
        id="pal-list"
        ref={listRef}
        className="pal-list"
        role="listbox"
        aria-label="Results"
        data-fx-density="dense"
      >
        <div ref={sizerRef} className="pal-sizer">
          <div ref={hlRef} className="pal-hl" aria-hidden="true" />
          {model.groups.map((g) => (
            // biome-ignore lint/a11y/useSemanticElements: a titled group of listbox options; a fieldset is for form controls
            <div key={g.id} role="group" aria-labelledby={`pal-g-${g.id}`} className="pal-group">
              <div id={`pal-g-${g.id}`} className="pal-gh">
                <span>{g.label}</span>
                <span className="pal-gc">
                  {g.more > 0 ? `${g.rows.length} of ${g.rows.length + g.more}` : g.rows.length}
                </span>
              </div>
              {g.rows.map((r) => (
                <RowView
                  key={r.id}
                  row={r}
                  q={text}
                  active={r.id === activeId}
                  onHover={onHover}
                  onPick={onPick}
                />
              ))}
            </div>
          ))}
          {model.seeAll ? (
            // biome-ignore lint/a11y/useSemanticElements: a titled group of listbox options; a fieldset is for form controls
            <div role="group" aria-label="More" className="pal-group pal-group-end">
              <RowView
                row={model.seeAll}
                q=""
                active={model.seeAll.id === activeId}
                onHover={onHover}
                onPick={onPick}
              />
            </div>
          ) : null}
          {showSkeleton ? <RowSkeletons /> : null}
          {showEmpty ? (
            <Empty text={text} chip={chip} chipLabel={chipLabel} prefix={model.input.prefix} />
          ) : null}
        </div>
      </div>

      <div className="pal-foot">
        <span className="pal-hint">
          <KeyCap k="up" />
          <KeyCap k="down" />
          move
        </span>
        <span className="pal-hint">
          <KeyCap k="enter" />
          open
        </span>
        {active?.alongside ? (
          <span className="pal-hint" data-pop="">
            <KeyCap k="shift" />
            <KeyCap k="enter" />
            alongside
          </span>
        ) : null}
        {active?.fly ? (
          <span className="pal-hint" data-pop="">
            <KeyCap k="alt" />
            <KeyCap k="enter" />
            fly
          </span>
        ) : null}
        {!model.input.prefix ? (
          <span className="pal-hint">
            <KeyCap k="tab" />
            kind
          </span>
        ) : null}
        {!text ? (
          <span className="pal-r">Understands heights, hashes, txids, addresses, IPs, apps</span>
        ) : null}
      </div>
      <div className="pal-live" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}

const EMPTY_HINT: Partial<Record<Prefix, { title: (t: string) => string; body: string }>> = {
  node: {
    title: (t) => `No node matches '${t}'`,
    body: 'Type an IP or IP:port, or the start of one such as 65.109. Collateral outputs look like txid:0.',
  },
  app: {
    title: (t) => `No app called '${t}'`,
    body: 'App names are matched loosely: a typo or two is fine.',
  },
  block: {
    title: (t) => `No block '${t}' yet`,
    body: 'Type a height up to the tip, a block hash, or tip for the latest block.',
  },
  tx: { title: (t) => `No transaction '${t}'`, body: 'A transaction id is 64 hexadecimal characters.' },
  addr: {
    title: (t) => `'${t}' is not an address`,
    body: 'Flux addresses start with t1 or t3 and run 26 to 36 characters.',
  },
  operator: {
    title: (t) => `'${t}' is not an operator`,
    body: 'Type a full payment address or a ZelID.',
  },
  goto: {
    title: (t) => `No place called '${t}'`,
    body: 'Try a country, a city, a region such as Europe, or coordinates like 60.17, 24.94.',
  },
  filter: {
    title: (t) => `No filter matches '${t}'`,
    body: 'Try a tier (stratus), a country (fi), a provider (hetzner), a FluxOS version (8.20.0), arcane or watched.',
  },
  layer: { title: (t) => `No layer called '${t}'`, body: 'Try mesh, flow or labels.' },
};

function Empty({
  text,
  chip,
  chipLabel,
  prefix,
}: {
  text: string;
  chip: KindChip;
  chipLabel: string;
  prefix: Prefix | null;
}) {
  const hint = prefix ? EMPTY_HINT[prefix] : undefined;
  const title = hint
    ? hint.title(text)
    : chip === 'all'
      ? `No match for '${text}'`
      : `Nothing under ${chipLabel} for '${text}'`;
  const body = hint
    ? hint.body
    : chip === 'all'
      ? 'Try a block height, a hash, a transaction id, an address, an IP with a port, or an app name.'
      : 'Press tab to look under another kind, or go back to All.';
  return (
    <EmptyState compact className="pal-empty" icon={SearchX} role="status" title={title}>
      {body}
    </EmptyState>
  );
}

export type { ServerState };
