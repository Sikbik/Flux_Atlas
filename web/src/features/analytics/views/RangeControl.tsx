// The time range of a history chart: 24 hours, 7 days or 30 days. It sits in the body above the chart,
// not in the section heading, so a narrow window never squeezes the title.

import { Row, SegmentedControl } from '../../../ui';
import { RANGES, type Range } from '../lib/metrics';

const OPTIONS = (['24h', '7d', '30d'] as const).map((value) => ({ value, label: RANGES[value].label }));

export function RangeControl({ value, onChange }: { value: Range; onChange: (range: Range) => void }) {
  return (
    <Row>
      <SegmentedControl
        size="sm"
        aria-label="Time range"
        options={OPTIONS}
        value={value}
        onChange={onChange}
      />
    </Row>
  );
}
