// Country code to continent, for "Six continents". A compact table, not a gazetteer: it only has to
// say which of six places a node's country belongs to. Transcontinental countries take the side most
// of their nodes sit on (Turkey and Russia count as Asia and Europe).

const GROUPS: Record<string, string> = {
  Europe:
    'AD AL AT AX BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
  Asia: 'AE AF AM AZ BD BH BN BT CN GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE',
  Africa:
    'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
  'North America':
    'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
  'South America': 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
  Oceania: 'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV VU WF WS',
};

const CONTINENT_OF: ReadonlyMap<string, string> = new Map(
  Object.entries(GROUPS).flatMap(([continent, codes]) =>
    codes.split(' ').map((c) => [c, continent] as const),
  ),
);

/** The continent of a two-letter country code, or null when unknown. */
export function continentOf(countryCode: string): string | null {
  return CONTINENT_OF.get(countryCode.trim().toUpperCase()) ?? null;
}

/** The six continents that count. */
export const CONTINENTS: readonly string[] = Object.keys(GROUPS);
