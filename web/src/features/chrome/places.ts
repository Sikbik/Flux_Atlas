// How a node's place reads in the chrome: its city when the data has one, otherwise its country, otherwise
// nothing (the caller says Unknown). The live data's city column can be empty, and a country is still
// honest and still tells where the node is; nothing here guesses a city. Countries read in their short
// form ("UK", "Hong Kong") because every place in the chrome sits in a small chip.

import type { NetworkStore } from '../../store/network';

export type NameStyle = 'long' | 'short';

function displayNames(style: NameStyle): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region', style });
  } catch {
    return null;
  }
}

const regionNames: Record<NameStyle, Intl.DisplayNames | null> = {
  long: displayNames('long'),
  short: displayNames('short'),
};

/** `FI` -> `Finland`; unknown codes read as themselves, an empty code as null. */
export function countryName(code: string, style: NameStyle = 'long'): string | null {
  if (!code) return null;
  try {
    return regionNames[style]?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The place of the node in row `i`: city, else country (short form), else null. */
export function placeOfRow(store: NetworkStore, i: number): string | null {
  const t = store.nodes;
  const city = t.locations.info(t.loc[i] ?? 0)?.city;
  if (city) return city;
  return countryName(t.countryCode(i), 'short');
}
