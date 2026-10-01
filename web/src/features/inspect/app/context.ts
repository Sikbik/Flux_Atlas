import { createContext, useContext } from 'react';
import type { AppDetailDto } from '../../../api/generated/AppDetailDto';
import type { AppLive } from '../sources/apps';

/** What every part of an app inspector reads: the app's detail and its live facts. */
export interface AppCtx {
  name: string;
  detail: AppDetailDto;
  live: AppLive;
  /** Tip height, null until the first block. */
  tip: number | null;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useAppCtx(): AppCtx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useAppCtx outside an app inspector');
  return c;
}
