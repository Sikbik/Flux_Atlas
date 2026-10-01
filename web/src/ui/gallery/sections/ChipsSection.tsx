import { Cpu, Globe, MapPin, Tag } from 'lucide-react';
import { useState } from 'react';
import { Badge, Chip, StatusChip, type StatusKind, TierChip, TierGlyph } from '../../index';
import { GallerySection, SpecGrid, Specimen } from '../primitives';

const STATUSES: readonly StatusKind[] = [
  'confirmed',
  'pending',
  'started',
  'syncing',
  'live',
  'at-risk',
  'degraded',
  'stale',
  'dos',
  'offline',
  'expired',
  'error',
  'unreachable',
  'departed',
  'unknown',
];

const FILTERS = ['Stratus', 'Nimbus', 'Cumulus'] as const;

/** Gallery section: Chip, TierChip, TierGlyph, StatusChip and Badge. */
export function ChipsSection() {
  const [on, setOn] = useState<ReadonlySet<string>>(new Set(['Stratus']));
  const toggle = (name: string) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <GallerySection
      id="chips"
      title="Chips and badges"
      lead="A chip is one short fact. Tier chips carry the capsule glyph in the tier colour, status chips an icon and a word on a soft fill: colour is never the only cue. Only the caps badge is set in capitals."
    >
      <SpecGrid min={360}>
        <Specimen
          title="Chip."
          caption="Neutral by default, accent for what is applied, ghost for quiet metadata. Plex Mono for data."
          layout="stack"
        >
          <div className="kg-row">
            <Chip>Neutral</Chip>
            <Chip tone="accent">Accent</Chip>
            <Chip tone="ghost">Ghost</Chip>
            <Chip icon={Globe}>Germany</Chip>
            <Chip icon={MapPin} tone="accent">
              Falkenstein
            </Chip>
            <Chip icon={Cpu} mono>
              8 cores
            </Chip>
            <Chip icon={Tag} mono tone="ghost">
              8.20.0
            </Chip>
          </div>
          <div className="kg-row">
            <Chip size="sm">20 px small</Chip>
            <Chip size="md">22 px medium</Chip>
            <Chip size="lg">26 px large</Chip>
          </div>
        </Specimen>
        <Specimen
          title="Filter chips."
          caption="Give a chip an onClick and it becomes a toggle button with aria-pressed. Hover, press and focus all show."
          layout="stack"
        >
          <div className="kg-row">
            {FILTERS.map((name) => (
              <Chip key={name} size="lg" selected={on.has(name)} onClick={() => toggle(name)}>
                {name}
              </Chip>
            ))}
          </div>
          <div className="kg-note">Selected: {on.size === 0 ? 'none' : [...on].join(', ')}</div>
        </Specimen>
        <Specimen
          title="TierChip."
          caption="The capsule glyph lights one, two or three bars. A payout amount rides after the word in Plex Mono; the operator's own node wears a white ring."
          layout="stack"
        >
          <div className="kg-row">
            <TierChip tier="cumulus" />
            <TierChip tier="nimbus" />
            <TierChip tier="stratus" />
            <TierChip tier="unknown" />
          </div>
          <div className="kg-row">
            <TierChip tier="stratus" size="lg" amount="+9.00" />
            <TierChip tier="nimbus" size="lg" amount="+3.50" />
            <TierChip tier="cumulus" size="lg" amount="+1.00" mine />
          </div>
          <div className="kg-row">
            <TierChip tier="stratus" size="sm" />
            <TierChip tier="stratus" glyph={false} />
            <TierChip tier={null} />
          </div>
        </Specimen>
        <Specimen
          title="TierGlyph."
          caption="The Flux-logo capsule stack as a tier mark: bars lit by tier, at any size."
        >
          <div className="kg-row" style={{ alignItems: 'flex-end', gap: 'var(--space-7)' }}>
            {[12, 16, 24, 40].map((px) => (
              <TierGlyph key={px} tier="stratus" size={px} />
            ))}
            <TierGlyph tier="nimbus" size={40} />
            <TierGlyph tier="cumulus" size={40} />
            <TierGlyph tier="unknown" size={40} />
          </div>
        </Specimen>
        <Specimen
          title="StatusChip."
          caption="Fifteen states over five reserved roles, each with its own icon and word. Pending and Started are never drawn as Confirmed; Unreachable is Unknown, not an error."
          span={2}
        >
          <div className="kg-row">
            {STATUSES.map((s) => (
              <StatusChip key={s} status={s} />
            ))}
          </div>
        </Specimen>
        <Specimen
          title="Badge."
          caption="The one ALL CAPS style, for status words in dense headers. Same five roles plus accent and neutral."
        >
          <div className="kg-row">
            <Badge tone="ok">Confirmed</Badge>
            <Badge tone="pending">Pending</Badge>
            <Badge tone="warn">At risk</Badge>
            <Badge tone="crit">DoS</Badge>
            <Badge tone="off">Unreachable</Badge>
            <Badge tone="accent">New</Badge>
            <Badge>Beta</Badge>
          </div>
          <div className="kg-row">
            <StatusChip status="confirmed" variant="badge" />
            <StatusChip status="started" variant="badge" />
            <StatusChip status="dos" variant="badge" />
            <StatusChip status="live" variant="badge" />
          </div>
        </Specimen>
      </SpecGrid>
    </GallerySection>
  );
}
