// The `/` view (design 2.2): the bare globe. Nothing is drawn here: the globe is the hero, and the Pulse, the
// rail and the aim strip belong to the frame. What this adds is the text twin of the canvas for assistive
// technology (design 10.3): a heading and one sentence of live facts, refreshed once a minute, never per
// tick. It sits in the stage, which is labelled "Globe".

import { useEffect, useState } from 'react';
import { useNetwork, useRuntime } from '../../app/context';
import { describeGlobe, GLOBE_DESCRIPTION_MS } from './home';

export function GlobeHome() {
  const runtime = useRuntime();
  const loaded = useNetwork((s) => s.loaded);
  const [text, setText] = useState(() => describeGlobe({ nodes: null, countries: null, tip: null }));
  useEffect(() => {
    const read = () => {
      const { summary, tip } = runtime.store;
      setText(
        describeGlobe({
          nodes: summary?.node_count ?? null,
          countries: summary?.country_count ?? null,
          tip: tip?.height ?? null,
        }),
      );
    };
    read();
    if (!loaded) return;
    const id = window.setInterval(read, GLOBE_DESCRIPTION_MS);
    return () => window.clearInterval(id);
  }, [runtime, loaded]);
  return (
    <div className="sr-only">
      <h1>Flux Atlas</h1>
      <p>{text}</p>
    </div>
  );
}
