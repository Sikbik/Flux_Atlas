import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

/** True while the element is (nearly) in view. `once` latches the first time it is seen. */
export function useVisible<T extends Element>(
  ref: RefObject<T | null>,
  opts: { once?: boolean; margin?: string } = {},
): boolean {
  const [seen, setSeen] = useState(false);
  const once = opts.once ?? false;
  const margin = opts.margin ?? '120px';
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setSeen(true);
            if (once) io.disconnect();
          } else if (!once) setSeen(false);
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, margin]);
  return seen;
}

/** Copies text to the clipboard; `copied` is true for 1.6 s afterwards. Never throws. */
export function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback((text: string) => {
    const done = () => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    };
    try {
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text).then(done, () => undefined);
        return;
      }
    } catch {
      // Clipboard blocked: fall through to the selection fallback.
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    } catch {
      // Nothing more to try.
    }
  }, []);
  return { copied, copy };
}

/** Re-renders the caller when the element's own size changes (width only). */
export function useWidth(ref: RefObject<Element | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setW(Math.round(e.contentRect.width));
    });
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [ref]);
  return w;
}
