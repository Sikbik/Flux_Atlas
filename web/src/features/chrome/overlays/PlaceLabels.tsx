// The globe's place labels (design 7.7), a chunk of their own: the layer mounts once the data is in and the
// shell chunk carries only the gate (globe/overlays.tsx). All per-frame positioning goes through the anchor
// system (no React render per frame); the arithmetic is in ../placelabels.ts and the look in labels.css.
//
// Labels are laid out to stay out of the way: a label floats above the tallest tower of its place (so it never
// sits on the light it names), is centred above that point, comes from a short list (the biggest places only),
// is culled against the other labels in node-count order and against the moon's clearance, fades out under the
// top chrome, and the whole layer follows the View menu's Labels switch.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNetwork, useRuntime } from '../../../app/context';
import { type Anchor, type PlaceOptions, useGlobeAnchor, useGlobeEngine } from '../../../globe';
import type { ZoomBand } from '../../../globe/engine/types';
import { useLabelsOn } from '../layers';
import {
  computePlaces,
  LABEL_LIMIT,
  labelAltitude,
  labelOpacity,
  labelWidth,
  type Place,
} from '../placelabels';
import { clearance, useClearance } from './clearance';
import './labels.css';

/**
 * Country labels at the global and continental zoom bands, city labels from the regional band
 * (design 7.7), culled against each other in node-count order and against the moon's clearance. The layer
 * stays mounted while the switch is off, so it keeps following the zoom band.
 */
export function PlaceLabelsLayer() {
  const runtime = useRuntime();
  const engine = useGlobeEngine();
  const on = useLabelsOn();
  const loaded = useNetwork((s) => s.loaded);
  const nodesVersion = useNetwork((s) => Math.floor(s.versions.Nodes / 50));
  const [band, setBand] = useState<ZoomBand>(0);
  useClearance();
  useEffect(() => {
    if (!engine) return;
    return engine.on('zoomBand', (z) => setBand(z.band));
  }, [engine]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed on load and every 50 node changes
  const places = useMemo(
    () => (loaded && on ? computePlaces(runtime.store) : { countries: [], cities: [] }),
    [runtime, loaded, on, nodesVersion],
  );
  const list = band >= 2 ? places.cities : places.countries;
  const kind = band >= 2 ? 'city' : 'country';
  if (!on) return null;
  return (
    <div className="globe-places" data-band={band}>
      {list.slice(0, LABEL_LIMIT[band]).map((p, k) => (
        <PlaceLabel key={p.id} place={p} priority={k} kind={kind} />
      ))}
    </div>
  );
}

/** A label's box sits this far above its anchor point (its height plus a breath of air). */
const LABEL_DY = -22;

function PlaceLabel({ place, priority, kind }: { place: Place; priority: number; kind: 'country' | 'city' }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastOpacity = useRef(-1);
  const anchor = useMemo<Anchor>(
    () => ({ kind: 'world', lat: place.lat, lon: place.lon, alt: labelAltitude(place.hub) }),
    [place.lat, place.lon, place.hub],
  );
  const w = useMemo(() => labelWidth(place.text, kind), [place.text, kind]);
  const options = useMemo<PlaceOptions>(
    () => ({
      group: 'places',
      priority,
      // Centred above the point: the box the anchor system culls is the box the eye sees.
      dx: -Math.round(w / 2),
      dy: LABEL_DY,
      // Never under the frame's panels, never on top of a dense cluster of nodes (anchors.ts).
      clip: 'free',
      avoidNodes: true,
      // The label's own fade: toward the limb like the anchor system's, and out under the top chrome.
      fade: false,
      onUpdate: (p) => {
        const el = ref.current;
        if (!el) return;
        const o = Math.round(labelOpacity(p.facing, p.y + LABEL_DY, clearance.top) * p.presence * 20) / 20;
        if (o !== lastOpacity.current) {
          lastOpacity.current = o;
          el.style.opacity = String(o);
        }
      },
    }),
    [priority, w],
  );
  useGlobeAnchor(ref, anchor, options);
  return (
    <div ref={ref} className={`globe-label globe-place globe-place-${kind}`}>
      {place.text}
    </div>
  );
}
