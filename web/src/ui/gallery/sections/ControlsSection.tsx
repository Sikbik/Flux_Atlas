import { ArrowRight, Bookmark, Download, ExternalLink, Pin, Plus, Share2, Trash2 } from 'lucide-react';
import {
  Button,
  CopyButton,
  EntityLink,
  HoverCard,
  IconButton,
  Kbd,
  KbdCombo,
  KeyValue,
  StatusChip,
  TierChip,
  Tooltip,
} from '../../index';
import { useGalleryData } from '../data';
import { GallerySection, SpecGrid, Specimen } from '../primitives';

/** Gallery section: Button, IconButton, CopyButton, Kbd, Tooltip and HoverCard. */
export function ControlsSection() {
  const { node, blocks } = useGalleryData();
  const hash = blocks?.[0]?.hash ?? '';

  return (
    <GallerySection
      id="controls"
      title="Buttons and small controls"
      lead="One primary action per view, secondary for everything else, ghost for tools, danger only for what cannot be undone. Every control has a hover, press, focus and disabled state; tooltips say what an icon does and the keyboard shortcut."
    >
      <SpecGrid min={380}>
        <Specimen
          title="Button, variants."
          caption="The primary is the one chamfered shape in the product and the only filled-blue surface."
          layout="stack"
        >
          <div className="kg-row">
            <Button variant="primary" icon={ArrowRight}>
              Open explorer
            </Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" icon={Trash2}>
              Remove
            </Button>
          </div>
          <div className="kg-row">
            <Button size="sm" variant="primary">
              Small primary
            </Button>
            <Button size="sm">Small</Button>
            <Button size="sm" variant="ghost" iconRight={ExternalLink}>
              Ghost
            </Button>
            <Button size="sm" pill icon={Plus}>
              Pill
            </Button>
          </div>
        </Specimen>
        <Specimen
          title="Button, states."
          caption="Loading keeps the width and ignores presses; disabled stays legible, never invisible."
          layout="stack"
        >
          <div className="kg-row">
            <Button variant="primary" loading>
              Saving
            </Button>
            <Button loading>Refreshing</Button>
            <Button disabled>Disabled</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="ghost" disabled>
              Ghost off
            </Button>
          </div>
        </Specimen>
        <Specimen
          title="IconButton."
          caption="Icon only, so it always has a name for assistive tech and a tooltip for everyone else."
          layout="stack"
        >
          <div className="kg-row">
            <Tooltip content="Pin to the dock">
              <IconButton icon={Pin} label="Pin to the dock" />
            </Tooltip>
            <Tooltip content="Download CSV">
              <IconButton icon={Download} label="Download CSV" variant="ghost" />
            </Tooltip>
            <Tooltip content="Share view">
              <IconButton icon={Share2} label="Share view" size="sm" />
            </Tooltip>
            <Tooltip content="Bookmark">
              <IconButton icon={Bookmark} label="Bookmark" size="sm" variant="ghost" />
            </Tooltip>
            <IconButton icon={Trash2} label="Remove" variant="danger" size="sm" />
          </div>
        </Specimen>
        <Specimen
          title="CopyButton."
          caption="Copies on press and says so: the icon turns to a check for a moment and screen readers hear Copied. A clipboard failure says Could not copy."
          layout="stack"
        >
          <div className="kg-row">
            <CopyButton value={hash} what="block hash" />
            <CopyButton value={hash} what="block hash" size="md" />
            <span className="ui-mono kg-line">{hash.slice(0, 18)}</span>
          </div>
        </Specimen>
        <Specimen
          title="Kbd and KbdCombo."
          caption="Keycaps for shortcuts in tooltips, menus and the command palette. Plex Mono, a lit top edge, and a spoken form for screen readers."
          layout="stack"
        >
          <div className="kg-row">
            <Kbd>Esc</Kbd>
            <Kbd>/</Kbd>
            <KbdCombo keys={['Ctrl', 'K']} />
            <KbdCombo keys={['Shift', 'Alt', 'P']} />
            <KbdCombo keys={['G', 'N']} />
          </div>
        </Specimen>
        <Specimen
          title="Tooltip."
          caption="A small glass label after 120 ms of hover or on focus. Moving between neighbours skips the delay. It flips when there is no room."
        >
          <div className="kg-row">
            <Tooltip content="Open the node inspector">
              <Button size="sm">Hover or focus me</Button>
            </Tooltip>
            <Tooltip
              placement="bottom"
              content={
                <>
                  Command palette <KbdCombo keys={['Ctrl', 'K']} />
                </>
              }
            >
              <Button size="sm" variant="ghost">
                With a shortcut
              </Button>
            </Tooltip>
            <Tooltip content="Always off" disabled>
              <Button size="sm" variant="ghost">
                Disabled tooltip
              </Button>
            </Tooltip>
          </div>
        </Specimen>
        <Specimen
          title="HoverCard."
          caption="A tooltip with substance: opens after 180 ms of mouse hover or on focus, stays open while the pointer is on it, closes on Escape. Never on touch."
        >
          <HoverCard
            label="Node preview"
            content={
              node ? (
                <div className="kg-preview">
                  <div className="kg-row">
                    <TierChip tier={node.tier} size="sm" />
                    <StatusChip status={node.status} size="sm" />
                  </div>
                  <KeyValue
                    items={[
                      { label: 'Endpoint', value: node.endpoint, mono: true },
                      { label: 'Rank', value: node.rank, mono: true },
                      { label: 'FluxOS', value: node.versions.flux_os, mono: true },
                    ]}
                  />
                  <EntityLink kind="node" value={node.endpoint} icon>
                    Open node
                  </EntityLink>
                </div>
              ) : (
                'Loading'
              )
            }
          >
            <Button size="sm" variant="secondary">
              Hover for a preview
            </Button>
          </HoverCard>
        </Specimen>
      </SpecGrid>
    </GallerySection>
  );
}
