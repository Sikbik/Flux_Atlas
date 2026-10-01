// The one attribute this feature mirrors onto <html> for the stylesheets to read.
//
// The performance tier is not one of them: the chrome (`features/chrome/prefs.ts`) is the one writer of
// `<html data-perf>`, with the governor's effective tier. Nor is the motion preference. The motion root (`motion/react/MotionRoot`) writes
// `<html data-motion>` as `full`, `reduced` or `off` and treats any other writer's value there as a mode the
// page forced; an earlier mirror in this file wrote `reduced` for Off, so the Off setting read as Reduced to
// the kit and to every effect. Stylesheets here key on `data-motion` ("off" and "reduced") and never write it.

/** The place-labels layer is the one the engine does not bind: `l=-labels` is applied here. */
export function syncLayerAttribute(l: unknown): void {
  const off = typeof l === 'string' && l.split(',').includes('-labels');
  if (off) document.documentElement.setAttribute('data-layer-labels', 'off');
  else document.documentElement.removeAttribute('data-layer-labels');
}
