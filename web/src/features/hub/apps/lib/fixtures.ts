// Small builders for the tests of this folder. Not imported by the app.

import type { AppIndexEntry } from '../../../../api/generated/AppIndexEntry';

export function app(over: Partial<AppIndexEntry> & { name: string }): AppIndexEntry {
  return {
    display_name: over.name,
    owner: 'owner-a',
    spec_version: 8,
    instances_target: 3,
    instances_running: 3,
    component_count: 1,
    enterprise: false,
    per_instance: { cpu: 1, ram_mb: 1024, hdd_gb: 10 },
    totals: { cpu: 3, ram_mb: 3072, hdd_gb: 30 },
    height: 1_000_000,
    expire_height: 1_100_000,
    ...over,
  };
}

/** An enterprise app: its components are private, so its spec reads as zero. */
export function enterprise(over: Partial<AppIndexEntry> & { name: string }): AppIndexEntry {
  return app({
    enterprise: true,
    component_count: 0,
    per_instance: { cpu: 0, ram_mb: 0, hdd_gb: 0 },
    totals: { cpu: 0, ram_mb: 0, hdd_gb: 0 },
    ...over,
  });
}
