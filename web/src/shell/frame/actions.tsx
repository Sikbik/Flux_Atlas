// Actions the shell's surfaces share (the frame provides them once): closing and focusing windows go
// through the URL so reload and Back always restore the same desktop; launching is the one list in
// launchers.tsx.

import { createContext, useContext } from 'react';
import type { WindowState } from '../wm/types';
import type { RunLauncher } from './launchers';

export interface ShellActions {
  requestClose(win: WindowState): void;
  focusWindow(win: WindowState): void;
  launch: RunLauncher;
}

export const ShellActionsContext = createContext<ShellActions | null>(null);

export function useShellActions(): ShellActions {
  const a = useContext(ShellActionsContext);
  if (!a) throw new Error('useShellActions must be used inside the shell frame');
  return a;
}
