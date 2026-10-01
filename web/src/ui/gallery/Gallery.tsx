// /dev/kit: every kit component in each of its states, on real data from the live server where that
// makes sense. A full-bleed panel over the globe; lazy-loaded by the router, never part of the shell.

import { Portal } from '../internal/floating';
import { ChartsSection } from './sections/ChartsSection';
import { ChipsSection } from './sections/ChipsSection';
import { ControlsSection } from './sections/ControlsSection';
import { FormsSection } from './sections/FormsSection';
import { FoundationsSection } from './sections/FoundationsSection';
import { IdentitySection } from './sections/IdentitySection';
import { LayoutSection } from './sections/LayoutSection';
import { LiveSection } from './sections/LiveSection';
import { NavSection } from './sections/NavSection';
import { OverlaySection } from './sections/OverlaySection';
import { ReadoutsSection } from './sections/ReadoutsSection';
import { StatesSection } from './sections/StatesSection';
import { TableSection } from './sections/TableSection';
import './gallery.css';

const NAV: ReadonlyArray<readonly [id: string, label: string]> = [
  ['foundations', 'Foundations'],
  ['layout', 'Layout'],
  ['readouts', 'Readouts'],
  ['chips', 'Chips'],
  ['identity', 'Identity'],
  ['controls', 'Controls'],
  ['states', 'States'],
  ['nav', 'Tabs'],
  ['table', 'Tables'],
  ['charts', 'Charts'],
  ['live', 'Live atoms'],
  ['forms', 'Forms'],
  ['overlays', 'Overlays'],
];

/**
 * The gallery lives in a portal on `document.body`: the shell's stage is a stacking context below the
 * dock and block rail, and the gallery needs the whole viewport between the top and status bars.
 */
export function Gallery() {
  return (
    <Portal>
      <div className="kit-gallery" data-testid="kit-gallery">
        <header className="kg-head">
          <h1>Component kit</h1>
          <p>
            Every component in every state, drawn from the design tokens and fed by the live server where a
            real value exists. Compose views from these; if something is missing, say so before building a
            one-off.
          </p>
        </header>
        <nav className="kg-nav" aria-label="Kit sections">
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <FoundationsSection />
        <LayoutSection />
        <ReadoutsSection />
        <ChipsSection />
        <IdentitySection />
        <ControlsSection />
        <StatesSection />
        <NavSection />
        <TableSection />
        <ChartsSection />
        <LiveSection />
        <FormsSection />
        <OverlaySection />
        <footer className="kg-foot">Flux Atlas UI kit. Dev gallery: not part of the product shell.</footer>
      </div>
    </Portal>
  );
}
