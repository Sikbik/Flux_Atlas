// Search in place for the Apps hub: the palette's own resolver, limited to apps. The examples are real apps from the
// loaded index (the biggest ones, one of each family of similar names), so a click shows what a result looks like
// before anything is typed. Until the index is in, a gray pill stands where the examples will be, so the field is as
// tall as it will be and the page does not move when they arrive.

import { useMemo } from 'react';
import type { AppIndexEntry } from '../../../api/generated/AppIndexEntry';
import type { GroupId } from '../../command/palette/types';
import { HubSearch } from '..';
import { appLabel, exampleApps } from './lib/apps';
import './apps.css';
import './ghost.css';

const GROUPS = ['apps'] as const satisfies readonly GroupId[];

export function AppsSearch({ apps }: { apps: readonly AppIndexEntry[] | undefined }) {
  const examples = useMemo(
    () => (apps ? exampleApps(apps, 2).map((a) => ({ label: appLabel(a), text: appLabel(a) })) : []),
    [apps],
  );
  return (
    <div className="ap-search" data-wait={apps ? undefined : ''}>
      <HubSearch
        label="Search apps"
        placeholder="App name"
        groups={GROUPS}
        hint="Type the name of an app. Enter opens the first match."
        examples={examples}
        emptyTitle={(text) => `No app matches '${text}'`}
        emptyText="Check the spelling, or type part of the name."
      />
    </div>
  );
}
