// Layout pieces for the /dev/kit gallery sections: a titled section, a responsive grid, and a
// specimen (a stage with a caption, like the design mock's component sheet).

import type { CSSProperties, ReactNode } from 'react';
import { cx } from '../internal/cx';

export interface GallerySectionProps {
  /** Anchor id (also the nav target), e.g. `charts`. */
  id: string;
  title: string;
  /** One or two sentences: what the group is for and the rule for using it. */
  lead?: ReactNode;
  children?: ReactNode;
}

/** A gallery section: heading, lead sentence, then specimens. */
export function GallerySection({ id, title, lead, children }: GallerySectionProps) {
  return (
    <section className="kg-section" id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="kg-section__title">
        {title}
      </h2>
      {lead ? <p className="kg-section__lead">{lead}</p> : null}
      {children}
    </section>
  );
}

export interface SpecGridProps {
  /** Minimum specimen width in px before the grid wraps (default 320). */
  min?: number;
  children: ReactNode;
}

/** A responsive grid of specimens (`span={2}` on a specimen makes it two columns wide). */
export function SpecGrid({ min = 320, children }: SpecGridProps) {
  return (
    <div className="kg-grid" style={{ '--kg-min': `${min}px` } as CSSProperties}>
      {children}
    </div>
  );
}

export interface SpecimenProps {
  /** Short name in bold at the start of the caption. */
  title: string;
  /** The rest of the caption: what the specimen shows. */
  caption?: ReactNode;
  /** `row` wraps children horizontally (default); `stack` stacks them with a gap. */
  layout?: 'row' | 'stack';
  /** Backdrop: the window slab (default), a raised card, the void, or the globe's deep blue. */
  surface?: 'slab' | 'raised' | 'void' | 'globe';
  /** Columns the specimen spans in a grid (1 to 3). */
  span?: 1 | 2 | 3;
  /** Remove the stage padding (for tables and full-bleed content); with `width` the content is drawn as a window slab. */
  flush?: boolean;
  /** Constrain the content to a width in px (a 420 px inspector, an 820 px explorer window). */
  width?: number;
  className?: string;
  children: ReactNode;
}

/** One specimen: a stage showing a component in a state, with a caption underneath. */
export function Specimen({
  title,
  caption,
  layout = 'row',
  surface = 'slab',
  span,
  flush,
  width,
  className,
  children,
}: SpecimenProps) {
  return (
    <figure className={cx('kg-spec', className)} data-span={span}>
      <div
        className="kg-stage"
        data-layout={layout}
        data-surface={surface}
        data-flush={flush && !width ? '' : undefined}
        data-windowed={flush && width ? '' : undefined}
      >
        {width ? (
          <div className="kg-stage__inner" style={{ width: `min(100%, ${width}px)` }}>
            {children}
          </div>
        ) : (
          children
        )}
      </div>
      <figcaption className="kg-caption">
        <b>{title}</b>
        {caption ? <> {caption}</> : null}
      </figcaption>
    </figure>
  );
}
