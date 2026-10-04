// The way out of a globe focus (focus.ts): a glass pill that says what the globe is picking out, with Clear
// (and Esc on a keyboard). On the desktop it sits under the aim strip, or in its place while the strip steps
// aside; on the phone it is a row of the header. It only exists while a focus does.

import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Globe, X } from 'lucide-react';
import { useMemo } from 'react';
import { useUi } from '../../store/ui';
import { Kbd } from '../../ui';
import { useAimPlacement } from './AimStrip';
import { focusLabel, globeFocus } from './focus';
import './globefocus.css';

export function GlobeFocus({ inline = false }: { inline?: boolean }) {
  const search = useRouterState({ select: (s) => s.location.search as { sel?: unknown; watched?: unknown } });
  const focus = useMemo(() => globeFocus(search), [search]);
  const watchedCount = useUi((s) => s.watched.length);
  const aim = useAimPlacement();
  const navigate = useNavigate();
  if (!focus) return null;
  const clear = () =>
    void navigate({
      to: '.',
      replace: true,
      search: ((prev: Record<string, unknown>) => ({ ...prev, sel: undefined, watched: undefined })) as never,
    });
  return (
    <div
      className="globefocus"
      role="status"
      data-inline={inline || undefined}
      data-below-aim={!inline && aim.shown ? '' : undefined}
      style={inline ? undefined : ({ '--aim-x': `${aim.centre}px` } as React.CSSProperties)}
    >
      <Globe className="globefocus-i" size={14} strokeWidth={1.75} aria-hidden="true" />
      <span className="globefocus-t">{focusLabel(focus, watchedCount)}</span>
      <button type="button" className="globefocus-clear" onClick={clear} aria-keyshortcuts="Escape">
        <X size={13} strokeWidth={2} aria-hidden="true" />
        Clear
        {inline ? null : <Kbd aria-hidden="true">Esc</Kbd>}
      </button>
    </div>
  );
}
