// Placeholder. Reserved for the globe engine port (labs/globe -> web/src/globe): the next teammate
// replaces this with GlobeCanvas (mounted once as the living wallpaper), store bindings
// (NetworkStore.subscribe -> engine.setNodes/updateNodes/setMesh) and an EffectSink attached with
// runtime.setEffectSink().

export function GlobeLayer() {
  return <div className="globe-layer" data-globe="placeholder" aria-hidden="true" />;
}
