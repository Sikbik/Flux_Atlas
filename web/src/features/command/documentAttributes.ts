// The few attributes this feature mirrors onto <html> for the stylesheets to read.
//
// The motion preference is not one of them. The motion root (`motion/react/MotionRoot`) writes
// `<html data-motion>` as `full`, `reduced` or `off` and treats any other writer's value there as a mode the
// page forced; an earlier mirror in this file wrote `reduced` for Off, so the Off setting read as Reduced to
// the kit and to every effect. Stylesheets here key on `data-motion` ("off" and "reduced") and never write it.

import { useUi } from '../../store/ui';

/** Mirrors the stored performance tier onto `<html data-perf>` (`high` and `lite` only; the rest is the default). */
export function syncPerfAttribute(): void {
  if (typeof document === 'undefined') return;
  const { perf } = useUi.getState();
  const el = document.documentElement;
  if (perf === 'high' || perf === 'lite') el.setAttribute('data-perf', perf);
  else el.removeAttribute('data-perf');
}

/** The place-labels layer is the one the engine does not bind: `l=-labels` is applied here. */
export function syncLayerAttribute(l: unknown): void {
  const off = typeof l === 'string' && l.split(',').includes('-labels');
  if (off) document.documentElement.setAttribute('data-layer-labels', 'off');
  else document.documentElement.removeAttribute('data-layer-labels');
}
