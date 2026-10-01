// <TabIndicator />: the line under the selected tab, travelling to each new selection. Render it as
// the last child of the tab list (which must be positioned). It finds the selected tab itself
// (aria-selected, aria-current or data-selected) and watches for changes, so the tabs keep their own
// state and styling and just drop their per-tab underline.

import { useLayoutEffect, useRef } from 'react';
import { installEngine } from '../engine';
import { createIndicator, SELECTED } from '../indicator';
import '../motion.css';

export function TabIndicator({ selector = SELECTED }: { selector?: string }) {
  const bar = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const release = installEngine();
    const ctl = createIndicator(el, host, selector);
    return () => {
      ctl.dispose();
      release();
    };
  }, [selector]);
  return <span ref={bar} className="fx-indicator" aria-hidden="true" />;
}
