import { effectiveMotion, useUi } from '../../../store/ui';

/** The motion level in effect (`full`, `reduced`, `off`): the app setting, else the OS preference. */
export function useMotion(): 'full' | 'reduced' | 'off' {
  const pref = useUi((s) => s.motion);
  return effectiveMotion(pref);
}

/** True when travel and looping effects are allowed. */
export function useFullMotion(): boolean {
  return useMotion() === 'full';
}
