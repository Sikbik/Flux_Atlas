// The toast stack's gate (design 6.4 H, 8.17). The stack itself (Toasts.tsx: the clocks, the exits, the icons,
// the styles) is a chunk of its own, mounted when the first toast is pushed and kept after that, so a toast
// that is leaving still fades and the next one steps in.

import { useState } from 'react';
import { useToasts } from '../../app/toasts';
import { lazyCard } from './lazyCard';

const stack = lazyCard(() => import('./Toasts').then((m) => m.Toasts));

export function ToastHost() {
  const any = useToasts((s) => s.toasts.length > 0);
  const [mounted, setMounted] = useState(any);
  if (any && !mounted) setMounted(true);
  return mounted ? <stack.Card /> : null;
}
