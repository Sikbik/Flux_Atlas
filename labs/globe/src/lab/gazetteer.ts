// A small gazetteer for captions: world cities plus the datacenter hubs Flux nodes cluster around.
// Hand-written from public geographic knowledge (city centroids, rounded); no external data.

const RAW = `
Helsinki|60.17|24.94|FI
Falkenstein|50.48|12.37|DE
Nuremberg|49.45|11.08|DE
Frankfurt|50.11|8.68|DE
Munich|48.14|11.58|DE
Berlin|52.52|13.40|DE
Hamburg|53.55|9.99|DE
Dusseldorf|51.23|6.78|DE
Cologne|50.94|6.96|DE
Stuttgart|48.78|9.18|DE
Leipzig|51.34|12.37|DE
Dresden|51.05|13.74|DE
Roubaix|50.69|3.17|FR
Gravelines|51.00|2.13|FR
Strasbourg|48.57|7.75|FR
Paris|48.86|2.35|FR
Lyon|45.76|4.84|FR
Marseille|43.30|5.37|FR
Bordeaux|44.84|-0.58|FR
Toulouse|43.60|1.44|FR
Lille|50.63|3.06|FR
Amsterdam|52.37|4.90|NL
Rotterdam|51.92|4.48|NL
Brussels|50.85|4.35|BE
Antwerp|51.22|4.40|BE
Luxembourg|49.61|6.13|LU
London|51.51|-0.13|GB
Manchester|53.48|-2.24|GB
Edinburgh|55.95|-3.19|GB
Dublin|53.35|-6.26|IE
Copenhagen|55.68|12.57|DK
Aarhus|56.16|10.21|DK
Stockholm|59.33|18.07|SE
Gothenburg|57.71|11.97|SE
Oslo|59.91|10.75|NO
Bergen|60.39|5.32|NO
Tampere|61.50|23.76|FI
Turku|60.45|22.27|FI
Reykjavik|64.15|-21.94|IS
Warsaw|52.23|21.01|PL
Krakow|50.06|19.94|PL
Gdansk|54.35|18.65|PL
Prague|50.08|14.44|CZ
Vienna|48.21|16.37|AT
Bratislava|48.15|17.11|SK
Budapest|47.50|19.04|HU
Zurich|47.38|8.54|CH
Geneva|46.20|6.14|CH
Milan|45.46|9.19|IT
Rome|41.90|12.50|IT
Naples|40.85|14.27|IT
Turin|45.07|7.69|IT
Madrid|40.42|-3.70|ES
Barcelona|41.39|2.17|ES
Valencia|39.47|-0.38|ES
Seville|37.39|-5.98|ES
Lisbon|38.72|-9.14|PT
Porto|41.15|-8.61|PT
Athens|37.98|23.73|GR
Sofia|42.70|23.32|BG
Bucharest|44.43|26.10|RO
Belgrade|44.79|20.45|RS
Zagreb|45.81|15.98|HR
Ljubljana|46.06|14.51|SI
Vilnius|54.69|25.28|LT
Riga|56.95|24.11|LV
Tallinn|59.44|24.75|EE
Kyiv|50.45|30.52|UA
Kharkiv|49.99|36.23|UA
Lviv|49.84|24.03|UA
Minsk|53.90|27.57|BY
Chisinau|47.01|28.86|MD
Moscow|55.76|37.62|RU
Saint Petersburg|59.93|30.34|RU
Taganrog|47.22|38.92|RU
Rostov-on-Don|47.24|39.72|RU
Novosibirsk|55.03|82.92|RU
Yekaterinburg|56.84|60.60|RU
Vladivostok|43.12|131.89|RU
Istanbul|41.01|28.98|TR
Ankara|39.93|32.86|TR
Tbilisi|41.72|44.79|GE
Yerevan|40.18|44.51|AM
Baku|40.41|49.87|AZ
Almaty|43.24|76.89|KZ
Tashkent|41.30|69.24|UZ
Tel Aviv|32.09|34.78|IL
Jerusalem|31.77|35.22|IL
Beirut|33.89|35.50|LB
Amman|31.95|35.93|JO
Riyadh|24.71|46.68|SA
Jeddah|21.49|39.19|SA
Manama|26.22|50.58|BH
Doha|25.29|51.53|QA
Dubai|25.20|55.27|AE
Abu Dhabi|24.45|54.38|AE
Muscat|23.59|58.41|OM
Kuwait City|29.38|47.99|KW
Tehran|35.69|51.39|IR
Baghdad|33.31|44.37|IQ
Karachi|24.86|67.01|PK
Lahore|31.55|74.34|PK
Delhi|28.61|77.21|IN
Mumbai|19.08|72.88|IN
Bengaluru|12.97|77.59|IN
Chennai|13.08|80.27|IN
Hyderabad|17.39|78.49|IN
Kolkata|22.57|88.36|IN
Dhaka|23.81|90.41|BD
Colombo|6.93|79.86|LK
Kathmandu|27.72|85.32|NP
Bangkok|13.76|100.50|TH
Hanoi|21.03|105.85|VN
Ho Chi Minh City|10.82|106.63|VN
Phnom Penh|11.56|104.93|KH
Kuala Lumpur|3.14|101.69|MY
Singapore|1.35|103.82|SG
Jakarta|-6.21|106.85|ID
Surabaya|-7.25|112.75|ID
Manila|14.60|120.98|PH
Hong Kong|22.32|114.17|HK
Shenzhen|22.54|114.06|CN
Guangzhou|23.13|113.26|CN
Shanghai|31.23|121.47|CN
Beijing|39.90|116.41|CN
Chengdu|30.57|104.07|CN
Wuhan|30.59|114.31|CN
Taipei|25.03|121.57|TW
Seoul|37.57|126.98|KR
Busan|35.18|129.08|KR
Tokyo|35.68|139.69|JP
Osaka|34.69|135.50|JP
Nagoya|35.18|136.91|JP
Sapporo|43.06|141.35|JP
Fukuoka|33.59|130.40|JP
Ulaanbaatar|47.89|106.91|MN
Sydney|-33.87|151.21|AU
Melbourne|-37.81|144.96|AU
Brisbane|-27.47|153.03|AU
Perth|-31.95|115.86|AU
Adelaide|-34.93|138.60|AU
Auckland|-36.85|174.76|NZ
Wellington|-41.29|174.78|NZ
Johannesburg|-26.20|28.05|ZA
Cape Town|-33.92|18.42|ZA
Durban|-29.86|31.02|ZA
Nairobi|-1.29|36.82|KE
Lagos|6.52|3.38|NG
Accra|5.60|-0.19|GH
Cairo|30.04|31.24|EG
Casablanca|33.57|-7.59|MA
Tunis|36.81|10.18|TN
Algiers|36.75|3.06|DZ
Addis Ababa|9.03|38.75|ET
Dar es Salaam|-6.79|39.21|TZ
Kampala|0.35|32.58|UG
Kinshasa|-4.44|15.27|CD
Luanda|-8.84|13.23|AO
New York|40.71|-74.01|US
Newark|40.74|-74.17|US
Boston|42.36|-71.06|US
Philadelphia|39.95|-75.17|US
Washington|38.91|-77.04|US
Ashburn|39.04|-77.49|US
Raleigh|35.78|-78.65|US
Charlotte|35.23|-80.84|US
Atlanta|33.75|-84.39|US
Miami|25.76|-80.19|US
Tampa|27.95|-82.46|US
Orlando|28.54|-81.38|US
Nashville|36.16|-86.78|US
Columbus|39.96|-83.00|US
Detroit|42.33|-83.05|US
Chicago|41.88|-87.63|US
Minneapolis|44.98|-93.27|US
Madison|43.07|-89.40|US
Kansas City|39.10|-94.58|US
Springfield|37.21|-93.29|US
St. Louis|38.63|-90.20|US
Dallas|32.78|-96.80|US
Houston|29.76|-95.37|US
Austin|30.27|-97.74|US
San Antonio|29.42|-98.49|US
Denver|39.74|-104.99|US
Phoenix|33.45|-112.07|US
Las Vegas|36.17|-115.14|US
Salt Lake City|40.76|-111.89|US
Los Angeles|34.05|-118.24|US
San Diego|32.72|-117.16|US
San Jose|37.34|-121.89|US
San Francisco|37.77|-122.42|US
Portland|45.52|-122.68|US
Seattle|47.61|-122.33|US
Anchorage|61.22|-149.90|US
Honolulu|21.31|-157.86|US
Toronto|43.65|-79.38|CA
Montreal|45.50|-73.57|CA
Beauharnois|45.32|-73.87|CA
Quebec City|46.81|-71.21|CA
Ottawa|45.42|-75.70|CA
Winnipeg|49.90|-97.14|CA
Calgary|51.05|-114.07|CA
Edmonton|53.55|-113.49|CA
Vancouver|49.28|-123.12|CA
Halifax|44.65|-63.57|CA
Mexico City|19.43|-99.13|MX
Guadalajara|20.66|-103.35|MX
Monterrey|25.69|-100.32|MX
Panama City|8.98|-79.52|PA
San Jose CR|9.93|-84.08|CR
Bogota|4.71|-74.07|CO
Medellin|6.24|-75.58|CO
Caracas|10.48|-66.90|VE
Quito|-0.18|-78.47|EC
Lima|-12.05|-77.04|PE
La Paz|-16.49|-68.12|BO
Santiago|-33.45|-70.67|CL
Buenos Aires|-34.60|-58.38|AR
Cordoba|-31.42|-64.18|AR
Montevideo|-34.90|-56.16|UY
Asuncion|-25.26|-57.58|PY
Sao Paulo|-23.55|-46.63|BR
Rio de Janeiro|-22.91|-43.17|BR
Brasilia|-15.79|-47.88|BR
Porto Alegre|-30.03|-51.23|BR
Fortaleza|-3.73|-38.52|BR
Havana|23.11|-82.37|CU
Santo Domingo|18.49|-69.93|DO
San Juan|18.47|-66.11|PR
`;

export interface Place {
  name: string;
  lat: number;
  lon: number;
  cc: string;
}

export const PLACES: Place[] = RAW.trim()
  .split('\n')
  .map((l) => {
    const [name, lat, lon, cc] = l.split('|');
    return { name, lat: Number(lat), lon: Number(lon), cc };
  });

const DEG = Math.PI / 180;

/** Nearest place within `maxKm`, or null. */
export function nearestPlace(lat: number, lon: number, maxKm = 140): Place | null {
  let best: Place | null = null;
  let bd = Infinity;
  const cl = Math.cos(lat * DEG);
  const x0 = cl * Math.cos(lon * DEG);
  const y0 = cl * Math.sin(lon * DEG);
  const z0 = Math.sin(lat * DEG);
  for (const p of PLACES) {
    const cp = Math.cos(p.lat * DEG);
    const dot = x0 * cp * Math.cos(p.lon * DEG) + y0 * cp * Math.sin(p.lon * DEG) + z0 * Math.sin(p.lat * DEG);
    const d = Math.acos(Math.min(1, Math.max(-1, dot))) * 6371;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best && bd <= maxKm ? best : null;
}

/** A short caption name for a coordinate: the nearest known place, else coordinates. */
export function placeName(lat: number, lon: number): string {
  const p = nearestPlace(lat, lon, 180);
  if (p) return p.name;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}${ns} ${Math.abs(lon).toFixed(1)}${ew}`;
}
