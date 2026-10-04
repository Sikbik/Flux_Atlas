import { Blocks } from 'lucide-react';
import { ViewHeader } from '../../../ui';

export function ExplorerView() {
  return (
    <article aria-label="Explorer">
      <ViewHeader kind="Explorer" icon={Blocks} title="The chain, live" subtitle="Placeholder." />
    </article>
  );
}
