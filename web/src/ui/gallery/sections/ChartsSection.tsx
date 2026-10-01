import { BarListSpecimens } from '../../charts/gallery/BarListSpecimens';
import { MeterSpecimens } from '../../charts/gallery/MeterSpecimens';
import { ShareBarSpecimens } from '../../charts/gallery/ShareBarSpecimens';
import { SparklineSpecimens } from '../../charts/gallery/SparklineSpecimens';
import { TimeSeriesSpecimens } from '../../charts/gallery/TimeSeriesSpecimens';
import { GallerySection } from '../primitives';

/** Gallery section: Sparkline, TimeSeries, BarList, ShareBar, Meter. */
export function ChartsSection() {
  return (
    <GallerySection
      id="charts"
      title="Charts"
      lead={
        <>
          Five chart components share one grammar: thin marks, hairline structure, the validated palette in a
          fixed order, data in Plex Mono, and an honest empty state. Motion is limited to what carries meaning
          (a live append, a changed length); every value here is real (live server or live store) unless a
          caption says synthetic.
        </>
      }
    >
      <SparklineSpecimens />
      <TimeSeriesSpecimens />
      <BarListSpecimens />
      <ShareBarSpecimens />
      <MeterSpecimens />
    </GallerySection>
  );
}
