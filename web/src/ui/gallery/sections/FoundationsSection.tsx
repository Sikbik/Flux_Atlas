import type { CSSProperties } from 'react';
import { GallerySection, SpecGrid, Specimen } from '../primitives';
import './foundations.css';

const SURFACES = ['void', 'ink-0', 'ink-1', 'ink-2', 'ink-3', 'ink-4', 'ink-5'] as const;
const ACCENT = ['950', '900', '800', '700', '600', '500', '400', '300', '200', '100'] as const;
const TEXT = ['text-1', 'text-2', 'text-3', 'text-4'] as const;
const STATUS = [
  ['ok', 'Confirmed'],
  ['pending', 'Started'],
  ['warn', 'At risk'],
  ['crit', 'DoS'],
  ['off', 'Unreachable'],
] as const;
const TIERS = ['cumulus', 'nimbus', 'stratus'] as const;
const VIZ = ['viz-1', 'viz-2', 'viz-3', 'viz-4', 'viz-5', 'viz-6', 'viz-other'] as const;

/** Gallery section: the tokens the kit stands on (surfaces, accent ramp, tier and status colours, type). */
export function FoundationsSection() {
  return (
    <GallerySection
      id="foundations"
      title="Foundations"
      lead="A black world lit by one sun and one brand. Surfaces lift from Flux Black toward Graphite with a Blue Wave cast; Flux blue is structure, white is attention, tier colours belong to tiers and status colours to state. Every kit component is drawn from these tokens and nothing else."
    >
      <SpecGrid min={360}>
        <Specimen
          title="Surfaces and text."
          caption="Elevation is lightness. Text ramps from white to the brand gray, which is for decoration and disabled only."
          layout="stack"
          surface="void"
        >
          <div className="kg-swatches" data-cols="7">
            {SURFACES.map((s) => (
              <div key={s} className="kg-swatch" style={{ background: `var(--${s})` }}>
                <span>{s}</span>
              </div>
            ))}
          </div>
          <div className="kg-swatches" data-cols="4">
            {TEXT.map((t) => (
              <div key={t} className="kg-swatch" data-text>
                <b aria-hidden="true" style={{ color: `var(--${t})` }} />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen
          title="Flux blue."
          caption="Derived from Blue Wave (600). 400 is the text and link accent on every ink; 600 fills buttons under white text."
          layout="stack"
          surface="void"
        >
          <div className="kg-ramp">
            {ACCENT.map((a) => (
              <i key={a} style={{ '--kg-c': `var(--accent-${a})` } as CSSProperties} title={`accent-${a}`}>
                <em />
                <small>{a}</small>
              </i>
            ))}
          </div>
          <div className="kg-ramp" data-viz>
            {VIZ.map((v) => (
              <i key={v} style={{ '--kg-c': `var(--${v})` } as CSSProperties} title={v}>
                <em />
                <small>{v.replace('viz-', '')}</small>
              </i>
            ))}
          </div>
        </Specimen>
        <Specimen
          title="Tier and status."
          caption="Tier colour only where a tier is named; status colour only with an icon and a word. Neither ever touches the logo."
          layout="stack"
          surface="void"
        >
          <div className="kg-swatches" data-cols="3">
            {TIERS.map((t) => (
              <div key={t} className="kg-swatch kg-swatch--tier" data-tier={t}>
                <i />
                <span>{t}</span>
              </div>
            ))}
          </div>
          <div className="kg-swatches" data-cols="5">
            {STATUS.map(([s, word]) => (
              <div key={s} className="kg-swatch kg-swatch--status" data-status={s}>
                <i />
                <span>{word}</span>
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen
          title="Type."
          caption="Montserrat for titles, labels and numerals; Open Sans for text; IBM Plex Mono for every piece of data; Lora once per view as an editorial line."
          layout="stack"
          span={3}
        >
          <div className="kg-type">
            <div className="kg-type__col">
              <div className="kg-type__display">2,997,616</div>
              <div className="kg-type__h1">Payment queue</div>
              <div className="kg-type__h2">Stratus, 9.00 FLUX per block</div>
            </div>
            <div className="kg-type__col">
              <div className="kg-type__body">
                Next in line to be paid. Rank 0 is paid in the next block, and the queue is known one block
                ahead.
              </div>
              <div className="kg-type__mono">65.109.26.93:16147 &nbsp; 8aa973…1beec &nbsp; 9.00 FLUX</div>
              <div className="kg-type__lora">
                To build a scalable, decentralized network of computing power for the people, by the people.
              </div>
            </div>
          </div>
        </Specimen>
      </SpecGrid>
    </GallerySection>
  );
}
