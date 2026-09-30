// Placeholder. Reserved for the shell (top bar, dock, windows, palette, terminal, toasts, rail,
// status bar, boot, ambient). The shell team replaces ShellFrame; routes render inside it.

import type { ReactNode } from 'react';

export function ShellFrame({ children }: { children: ReactNode }) {
  return <main className="shell-frame">{children}</main>;
}
