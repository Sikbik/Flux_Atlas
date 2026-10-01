// The archive grade: a cool, desaturated cast over the globe with scanlines and a vignette, so the
// past never passes for the present. It is a CSS layer between the globe and the interface (no
// engine change); the moon takes it with the rest of the picture. It fades in and out over 600 ms.

export function Grade({ on }: { on: boolean }) {
  return <div className="tm-grade" data-on={on || undefined} aria-hidden="true" />;
}
