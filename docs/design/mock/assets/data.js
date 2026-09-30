/* Flux Atlas design mock: data layer.
   Real values come from docs/research/fixtures (block heights, hashes and times, the winning nodes, the node
   and tx records, app history, network totals). Node geography for the long tail is synthetic and seeded so
   screenshots are deterministic; anchor nodes (hero host, winners, producer, peers, app instances) use real
   IPs with geo looked up from their ISPs. Anything illustrative is marked `illustrative: true` in this file. */
(function () {
  'use strict';
  var D = (window.ATLAS_DATA = {});

  /* ---------- deterministic rng ---------- */
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  var R = mulberry32(20260930);
  var rnd = function (a, b) { return a + (b - a) * R(); };
  var ri = function (a, b) { return Math.floor(rnd(a, b + 1)); };
  var pick = function (arr) { return arr[Math.floor(R() * arr.length)]; };
  D.rng = R;

  /* ---------- network totals (docs/research/flux-api.md section 1, 2026-09-30) ---------- */
  D.network = {
    nodes: 6724, tiers: { cumulus: 3378, nimbus: 1582, stratus: 1764 }, hosts: 2655, upnpPct: 64.4,
    apps: 1882, appsRunning: 1779, instances: 8274, countries: 54, asns: 234,
    arcanePct: 94, fluxos: '8.20.0', fluxosPct: 99.9, daemon: '9.1.0',
    cores: 54451, ramTB: 182, ssdPB: 3.19, lockedCpuPct: 27, lockedRamPct: 16, lockedSsdPct: 12,
    operators: 840, reachable: 6571,
    hetznerPct: 24, ghostnetPct: 7.4, stofaPct: 6.3,
    reward: { cumulus: 1.0, nimbus: 3.5, stratus: 9.0, fund: 0.5 },
    cycleHours: { cumulus: 28, nimbus: 13.2, stratus: 14.7 }
  };
  D.price = { usd: 0.074595, change24h: 1.95, mcap: 31370296 };
  D.supply = { circulating: 420590294.4991484, total: 430655620.5 };
  D.mempool = { tx: 20, bytes: 4039 };
  D.emission = { cutHeight: 3071200, intervalBlocks: 1051200 };

  /* ---------- clock: fixed demo time so screenshots are deterministic ---------- */
  D.clock = { tip: 2996929, tipTime: 1790797594, demoNow: 1790797594 + 12 };  /* 19:46:46 UTC, next block in 18 s */

  /* ---------- hubs (name, cc, lat, lon, weight, org, type, ip prefixes) ---------- */
  var H = [
    ['Helsinki', 'FI', 60.1719, 24.9347, 640, 'Hetzner Online GmbH', 'dc', ['65.108', '65.109', '95.216', '95.217', '135.181', '37.27', '157.180', '65.21']],
    ['Falkenstein', 'DE', 50.4777, 12.3649, 560, 'Hetzner Online GmbH', 'dc', ['94.130', '88.198', '5.9', '136.243', '148.251', '176.9', '78.46', '144.76', '138.201', '159.69', '162.55', '168.119', '195.201', '116.202', '142.132']],
    ['Nuremberg', 'DE', 49.4521, 11.0767, 330, 'Hetzner Online GmbH', 'dc', ['23.88', '49.12', '91.107', '116.203', '157.90', '167.235']],
    ['Frankfurt', 'DE', 50.1109, 8.6821, 512, 'GHOSTnet GmbH', 'dc', ['5.230']],
    ['Copenhagen', 'DK', 55.6769, 12.5268, 416, 'Stofa A/S', 'res', ['62.107']],
    ['Gravelines', 'FR', 50.9871, 2.1285, 260, 'OVH SAS', 'dc', ['51.68', '51.75', '51.77', '135.125', '141.94', '145.239', '15.235']],
    ['Roubaix', 'FR', 50.6942, 3.1746, 120, 'OVH SAS', 'dc', ['54.36', '149.202']],
    ['Strasbourg', 'FR', 48.5734, 7.7521, 70, 'OVH SAS', 'dc', ['51.83']],
    ['Paris', 'FR', 48.8566, 2.3522, 190, 'Free SAS', 'res', ['82.64', '82.65', '82.67', '109.21', '92.159', '77.132']],
    ['London', 'GB', 51.5074, -0.1278, 150, 'Various', 'res', ['81.2', '86.14', '90.196']],
    ['Amsterdam', 'NL', 52.3676, 4.9041, 140, 'Various', 'dc', ['185.107', '193.142']],
    ['Warsaw', 'PL', 52.2297, 21.0122, 120, 'OVH SAS', 'dc', ['51.38', '37.59']],
    ['Vilnius', 'LT', 54.6872, 25.2797, 80, 'Various', 'dc', ['91.226', '80.95']],
    ['Milan', 'IT', 45.4642, 9.19, 70, 'Various', 'res', ['79.26', '93.47']],
    ['Madrid', 'ES', 40.4168, -3.7038, 60, 'Various', 'res', ['79.150', '83.44']],
    ['Zurich', 'CH', 47.3769, 8.5417, 40, 'Various', 'dc', ['46.140']],
    ['Stockholm', 'SE', 59.3293, 18.0686, 80, 'Various', 'res', ['90.228', '213.66']],
    ['Oslo', 'NO', 59.9139, 10.7522, 50, 'Telenor', 'res', ['79.161']],
    ['Prague', 'CZ', 50.0755, 14.4378, 45, 'Various', 'dc', ['185.40']],
    ['Moscow', 'RU', 55.7558, 37.6173, 70, 'Various', 'dc', ['193.124', '95.31']],
    ['Taganrog', 'RU', 47.2189, 38.9168, 109, 'PG19 Taganrog', 'res', ['80.72']],
    ['Kyiv', 'UA', 50.4501, 30.5234, 30, 'Various', 'res', ['91.203']],
    ['Maia', 'PT', 41.2346, -8.6183, 70, 'MEO', 'res', ['188.250', '95.94']],
    ['Karlsruhe', 'DE', 49.0069, 8.4037, 88, 'IONOS SE', 'dc', ['82.165']],
    ['Reston', 'US', 38.958, -77.3592, 180, 'OVH US LLC', 'dc', ['135.148', '51.81', '147.135', '15.204']],
    ['Ashburn', 'US', 39.0438, -77.4874, 120, 'Node Orbit', 'dc', ['38.83', '38.240']],
    ['Raleigh', 'US', 35.7704, -78.6293, 74, 'Node Orbit', 'dc', ['38.247']],
    ['New York', 'US', 40.7128, -74.006, 110, 'Various', 'res', ['96.60', '24.246']],
    ['Atlanta', 'US', 33.749, -84.388, 60, 'Various', 'res', ['73.149']],
    ['Miami', 'US', 25.7617, -80.1918, 60, 'Various', 'res', ['72.72']],
    ['Chicago', 'US', 41.8781, -87.6298, 90, 'Various', 'res', ['142.126']],
    ['Dallas', 'US', 32.7767, -96.797, 120, 'Various', 'dc', ['208.102', '66.43']],
    ['Kansas City', 'US', 39.0997, -94.5786, 40, 'Various', 'res', ['47.162']],
    ['Denver', 'US', 39.7392, -104.9903, 40, 'Various', 'res', ['67.165']],
    ['Los Angeles', 'US', 34.0522, -118.2437, 110, 'Various', 'dc', ['64.32', '206.198']],
    ['San Jose', 'US', 37.3382, -121.8863, 60, 'Various', 'dc', ['157.211']],
    ['Seattle', 'US', 47.6062, -122.3321, 50, 'Various', 'res', ['50.46']],
    ['Beauharnois', 'CA', 45.3167, -73.8667, 110, 'OVH Hosting', 'dc', ['158.69', '192.99', '142.44', '51.79', '51.161']],
    ['Toronto', 'CA', 43.6532, -79.3832, 60, 'Various', 'res', ['70.26']],
    ['Vancouver', 'CA', 49.2827, -123.1207, 30, 'Various', 'res', ['24.68']],
    ['Mexico City', 'MX', 19.4326, -99.1332, 25, 'Various', 'res', ['187.190']],
    ['Sao Paulo', 'BR', -23.5505, -46.6333, 70, 'Various', 'res', ['177.12', '189.6']],
    ['Buenos Aires', 'AR', -34.6037, -58.3816, 25, 'Various', 'res', ['181.47']],
    ['Santiago', 'CL', -33.4489, -70.6693, 12, 'Various', 'res', ['190.113']],
    ['Bogota', 'CO', 4.711, -74.0721, 8, 'Various', 'res', ['186.29']],
    ['Singapore', 'SG', 1.3521, 103.8198, 110, 'Various', 'dc', ['139.99', '103.253']],
    ['Tokyo', 'JP', 35.6762, 139.6503, 80, 'Various', 'res', ['218.221', '153.120']],
    ['Osaka', 'JP', 34.6937, 135.5023, 30, 'Various', 'res', ['219.117']],
    ['Seoul', 'KR', 37.5665, 126.978, 50, 'Various', 'dc', ['211.44']],
    ['Hong Kong', 'HK', 22.3193, 114.1694, 50, 'Various', 'dc', ['103.224']],
    ['Mumbai', 'IN', 19.076, 72.8777, 40, 'Various', 'res', ['49.36']],
    ['Bangalore', 'IN', 12.9716, 77.5946, 15, 'Various', 'res', ['106.51']],
    ['Dubai', 'AE', 25.2048, 55.2708, 25, 'Various', 'dc', ['94.200']],
    ['Istanbul', 'TR', 41.0082, 28.9784, 20, 'Various', 'res', ['78.180']],
    ['Tel Aviv', 'IL', 32.0853, 34.7818, 15, 'Various', 'res', ['5.102']],
    ['Sydney', 'AU', -33.8688, 151.2093, 70, 'Various', 'dc', ['139.180', '101.167']],
    ['Melbourne', 'AU', -37.8136, 144.9631, 25, 'Various', 'res', ['120.148']],
    ['Perth', 'AU', -31.9505, 115.8605, 10, 'Various', 'res', ['121.200']],
    ['Auckland', 'NZ', -36.8485, 174.7633, 10, 'Various', 'res', ['202.36']],
    ['Johannesburg', 'ZA', -26.2041, 28.0473, 25, 'Various', 'dc', ['41.76']],
    ['Lagos', 'NG', 6.5244, 3.3792, 8, 'Various', 'res', ['105.112']],
    ['Nairobi', 'KE', -1.2921, 36.8219, 6, 'Various', 'res', ['41.80']],
    ['Bangkok', 'TH', 13.7563, 100.5018, 15, 'Various', 'res', ['171.96']],
    ['Jakarta', 'ID', -6.2088, 106.8456, 10, 'Various', 'res', ['36.68']],
    ['Manila', 'PH', 14.5995, 120.9842, 8, 'Various', 'res', ['112.198']],
    ['Taipei', 'TW', 25.033, 121.5654, 20, 'Various', 'res', ['118.163']],
    ['Cairo', 'EG', 30.0444, 31.2357, 6, 'Various', 'res', ['41.33']]
  ].map(function (h, i) { return { id: i, name: h[0], cc: h[1], lat: h[2], lon: h[3], w: h[4], org: h[5], type: h[6], pre: h[7] }; });
  D.hubs = H;
  var hubByName = {}; H.forEach(function (h) { hubByName[h.name] = h; });

  /* ---------- anchors: real IPs from the fixtures ---------- */
  var T = { CUMULUS: 0, NIMBUS: 1, STRATUS: 2 };
  D.tierNames = ['cumulus', 'nimbus', 'stratus'];
  D.tierLabel = ['Cumulus', 'Nimbus', 'Stratus'];
  var anchors = []; var A = {};
  function anchor(key, ip, port, tier, hubName, extra) {
    var h = hubByName[hubName];
    var o = Object.assign({ key: key, ip: ip, port: port, tier: tier, hub: h.id, lat: h.lat, lon: h.lon, anchor: true }, extra || {});
    anchors.push(o); if (key) A[key] = o; return o;
  }
  /* hero host 65.109.26.93: 7 nodes, one payment address (nodes.json, 2026-09-30) */
  var heroPay = 't1cz5PE2QWsptPPWxQ7iFhb1eG9Pv6Aq5g9';
  var heroHost = [
    [16147, 2, 0, 2846353, 2995211, '03167acd7621d4e01f97652c984e0f151b40e937d4b477f431babd51b0b9a216'],
    [16127, 2, 1699, 2955769, 2996852, 'ee30c7571c19'], [16137, 0, 812, 2864853, 2994426, 'c0786ae223f1'],
    [16157, 2, 1319, 2662338, 2996488, '7c01f7f74f3e'], [16167, 2, 1121, 2723495, 2996302, 'ba465a30632e'],
    [16177, 2, 1228, 2312080, 2996407, '65a4f29ad7e0'], [16187, 2, 1617, 2861374, 2996773, 'c709a5d9e25c']
  ];
  D.hero = null; D.heroHost = [];
  heroHost.forEach(function (n, i) {
    var o = anchor(i === 0 ? 'hero' : null, '65.109.26.93', n[0], n[1], 'Helsinki', { rank: n[2], added: n[3], paid: n[4], txh: n[5], pay: heroPay });
    D.heroHost.push(o);
  });
  D.hero = A.hero;
  /* winners of the next block (fluxnodecurrentwinner) */
  A.winC = anchor('winC', '80.72.20.160', 16137, 0, 'Taganrog', { rank: 0, lat: 47.2189, lon: 38.9168, pay: 't1JLjEtuPgeieJt5mJzgHof4SmMgcdGCHnv' });
  A.winN = anchor('winN', '38.247.82.140', 16147, 1, 'Raleigh', { rank: 0, lat: 35.7704, lon: -78.6293, pay: 't1dX9RFbWW8pBQuKd6vqAy5uUUQojNrHUcj' });
  A.winS = A.hero;
  /* the producer of block 2,996,900 (Reston, OVH US) and of 2,996,914 (Helsinki) */
  A.prod = anchor('prod', '135.148.27.2', 16187, 0, 'Reston', { lat: 38.958, lon: -77.3592, pay: 't3UmJKLzn5K8zKePZmYjFMosmQ4A1yqC4KG' });
  A.prod2 = anchor('prod2', '65.109.63.147', 16147, 1, 'Helsinki', { pay: 't1erTe9pzQRnT1J7irwdoMb6kQqPQDvkktA' });
  A.falk = anchor('falk', '94.130.137.2', 16127, 2, 'Falkenstein', { pay: 't1NQmxGmEoMt8F2ccH2EEnfjhugrERdDb8k' });
  /* a few more hosts of the winners */
  [16127, 16147, 16157, 16177, 16187, 16197].forEach(function (p) { anchor(null, '80.72.20.160', p, 0, 'Taganrog', { lat: 47.2189, lon: 38.9168 }); });
  [16137, 16157, 16177, 16197].forEach(function (p, i) { anchor(null, '38.247.82.140', p, i === 0 ? 1 : (i === 1 ? 0 : 1), 'Raleigh', { lat: 35.7704, lon: -78.6293 }); });
  /* BitcoinWhitepaper instances (apps_location fixture) */
  D.appNodes = [
    anchor('bw1', '65.21.18.14', 16127, 2, 'Helsinki', { app: 'BitcoinWhitepaper' }),
    anchor('bw2', '65.108.75.162', 16127, 2, 'Helsinki', { app: 'BitcoinWhitepaper' }),
    anchor('bw3', '188.250.36.83', 16167, 0, 'Maia', { app: 'BitcoinWhitepaper', lat: 41.2346, lon: -8.6183 })
  ];
  /* peers of the hero (flux_connectedpeers, flux_incomingconnections fixtures); geo approximated from ISP ranges */
  var peerRaw = [
    ['144.76.17.22', 'out', 'Falkenstein'], ['65.21.80.11', 'out', 'Helsinki'], ['65.108.230.76', 'out', 'Helsinki'], ['138.201.125.31', 'out', 'Falkenstein'],
    ['82.67.138.194', 'out', 'Paris'], ['103.224.116.112', 'out', 'Hong Kong'], ['65.109.121.73', 'out', 'Helsinki'], ['65.108.133.95', 'out', 'Helsinki'],
    ['188.40.118.159', 'out', 'Falkenstein'], ['23.88.0.60', 'out', 'Nuremberg'], ['135.181.226.132', 'out', 'Helsinki'], ['62.107.25.219', 'out', 'Copenhagen'],
    ['95.94.89.186', 'out', 'Maia'], ['2.59.185.154', 'out', 'Frankfurt'], ['24.246.159.121', 'out', 'New York'], ['208.102.14.252', 'out', 'Dallas'],
    ['82.165.136.147', 'out', 'Karlsruhe'], ['82.165.136.150', 'out', 'Karlsruhe'],
    ['62.107.25.252', 'in', 'Copenhagen'], ['148.251.42.208', 'in', 'Falkenstein'], ['38.240.227.107', 'in', 'Ashburn'], ['79.161.168.156', 'in', 'Oslo'],
    ['65.109.127.149', 'in', 'Helsinki'], ['90.228.206.207', 'in', 'Stockholm'], ['38.83.170.11', 'in', 'Ashburn'], ['23.88.73.205', 'in', 'Nuremberg'],
    ['5.9.87.73', 'in', 'Falkenstein'], ['176.9.136.243', 'in', 'Falkenstein'], ['65.108.237.216', 'in', 'Helsinki'], ['40.160.92.120', 'in', 'Chicago'],
    ['96.60.107.22', 'in', 'New York'], ['62.107.25.225', 'in', 'Copenhagen'], ['162.55.94.150', 'in', 'Falkenstein'], ['47.162.217.180', 'in', 'Kansas City'],
    ['62.107.25.239', 'in', 'Copenhagen'], ['38.240.227.236', 'in', 'Ashburn'], ['135.148.27.2', 'in', 'Reston'], ['193.124.181.223', 'in', 'Moscow'],
    ['65.108.98.77', 'in', 'Helsinki']
  ];
  D.peers = peerRaw.map(function (p, i) {
    var h = hubByName[p[2]];
    var o = anchor(null, p[0], 16127, [0, 0, 1, 2, 0, 1][i % 6], p[2], { peer: p[1] });
    o.lat = h.lat + rnd(-0.03, 0.03); o.lon = h.lon + rnd(-0.03, 0.03);
    return { node: o, ip: p[0], dir: p[1], city: p[2], cc: h.cc, lat: o.lat, lon: o.lon, ms: Math.round(Math.max(1, 1 + 0.018 * distKm(60.1719, 24.9347, h.lat, h.lon) + rnd(0, 6))) };
  });
  function distKm(la1, lo1, la2, lo2) { var r = Math.PI / 180, a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(a)); }
  D.distKm = distKm;

  /* ---------- synthetic nodes ---------- */
  var N = D.network.nodes;
  var nodes = { n: 0, lat: [], lon: [], tier: [], hub: [], host: [], flags: [], ip: [], port: [], rank: [], anchor: [], key: [] };
  var hosts = []; // {ip, nodes:[...], hub}
  var usedIp = {};
  function newIp(h) { for (var k = 0; k < 50; k++) { var ip = pick(h.pre) + '.' + ri(1, 254) + '.' + ri(1, 254); if (!usedIp[ip]) { usedIp[ip] = 1; return ip; } } return h.pre[0] + '.' + ri(1, 254) + '.' + ri(1, 254); }
  function addNode(o) {
    var i = nodes.n++;
    nodes.lat.push(o.lat); nodes.lon.push(o.lon); nodes.tier.push(o.tier); nodes.hub.push(o.hub); nodes.host.push(o.host);
    nodes.flags.push(o.flags || 0); nodes.ip.push(o.ip); nodes.port.push(o.port); nodes.rank.push(o.rank == null ? -1 : o.rank);
    nodes.anchor.push(o.anchor ? 1 : 0); nodes.key.push(o.key || '');
    return i;
  }
  var hostMap = {};
  anchors.forEach(function (a) {
    var hk = a.ip; var hi = hostMap[hk];
    if (hi == null) { hi = hostMap[hk] = hosts.length; hosts.push({ ip: a.ip, nodes: [], hub: a.hub, lat: a.lat, lon: a.lon }); usedIp[a.ip] = 1; }
    a.host = hi;
    a.flags = 1; /* arcane */
    a.idx = addNode(a); hosts[hi].nodes.push(a.idx);
  });
  /* host size distribution (mean about 2.5) */
  var sizes = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 6, 8, 8, 8];
  var totalW = H.reduce(function (s, h) { return s + h.w; }, 0);
  var target = N - nodes.n - 250;
  /* per-hub sub-sites: datacenter hubs put 70% at the primary coordinate */
  H.forEach(function (h) {
    var share = Math.round(h.w / totalW * target);
    var subs = [{ lat: h.lat, lon: h.lon, w: 0.72 }];
    var extra = h.type === 'dc' ? ri(2, 4) : ri(4, 8);
    for (var k = 0; k < extra; k++) subs.push({ lat: h.lat + rnd(-0.18, 0.18), lon: h.lon + rnd(-0.26, 0.26), w: (1 - 0.72) / extra });
    if (h.type === 'res') subs[0].w = 0.3;
    var left = share;
    while (left > 0) {
      var sz = Math.min(left, pick(sizes));
      var r0 = R(), acc = 0, s = subs[0];
      for (var q = 0; q < subs.length; q++) { acc += subs[q].w; if (r0 <= acc) { s = subs[q]; break; } }
      var hi = hosts.length; var ip = newIp(h);
      hosts.push({ ip: ip, nodes: [], hub: h.id, lat: s.lat, lon: s.lon });
      var tierBias = h.type === 'dc' ? [0.40, 0.25, 0.35] : [0.68, 0.20, 0.12];
      for (var j = 0; j < sz; j++) {
        var rr = R(), t = rr < tierBias[0] ? 0 : (rr < tierBias[0] + tierBias[1] ? 1 : 2);
        var fl = (R() < 0.94 ? 1 : 0) | (R() < 0.012 ? 2 : 0);
        var idx = addNode({ lat: s.lat, lon: s.lon, tier: t, hub: h.id, host: hi, flags: fl, ip: ip, port: 16127 + 10 * j });
        hosts[hi].nodes.push(idx);
      }
      left -= sz;
    }
  });
  /* the long tail: scattered home nodes near population centres */
  for (var t = 0; t < 250; t++) {
    var h2 = pick(H); var hi2 = hosts.length;
    var lat = h2.lat + rnd(-2.6, 2.6), lon = h2.lon + rnd(-3.6, 3.6);
    hosts.push({ ip: newIp(h2), nodes: [], hub: h2.id, lat: lat, lon: lon });
    var idx2 = addNode({ lat: lat, lon: lon, tier: R() < 0.72 ? 0 : (R() < 0.6 ? 1 : 2), hub: h2.id, host: hi2, flags: (R() < 0.9 ? 1 : 0) | (R() < 0.02 ? 2 : 0) | 32, ip: hosts[hi2].ip, port: 16127 });
    hosts[hi2].nodes.push(idx2);
  }
  /* trim or pad to exactly N */
  while (nodes.n > N) { var d = nodes.n - 1; for (var kk in nodes) if (Array.isArray(nodes[kk])) nodes[kk].pop(); nodes.n--; }
  /* pad if short (rare) */
  while (nodes.n < N) { var h3 = pick(H); var hi3 = hosts.length; hosts.push({ ip: newIp(h3), nodes: [], hub: h3.id, lat: h3.lat, lon: h3.lon }); var ix = addNode({ lat: h3.lat + rnd(-1, 1), lon: h3.lon + rnd(-1, 1), tier: 0, hub: h3.id, host: hi3, flags: 1, ip: hosts[hi3].ip, port: 16127 }); hosts[hi3].nodes.push(ix); }
  /* exact tier totals: flip random synthetic nodes */
  var cnt = [0, 0, 0]; for (var i3 = 0; i3 < nodes.n; i3++) cnt[nodes.tier[i3]]++;
  var want = [D.network.tiers.cumulus, D.network.tiers.nimbus, D.network.tiers.stratus];
  function flip(from, to) { for (var g = 0; g < 100000; g++) { var x = Math.floor(R() * nodes.n); if (!nodes.anchor[x] && nodes.tier[x] === from) { nodes.tier[x] = to; cnt[from]--; cnt[to]++; return; } } }
  for (var pass = 0; pass < 6000; pass++) {
    var over = -1, under = -1;
    for (var tt = 0; tt < 3; tt++) { if (cnt[tt] > want[tt]) over = tt; if (cnt[tt] < want[tt]) under = tt; }
    if (over < 0 || under < 0) break; flip(over, under);
  }

  /* unreachable cluster (weather layer), at-risk nodes, recently paid */
  var weatherCentres = [[50, 36, 7, 0.22], [-15, -50, 9, 0.12], [8, 105, 8, 0.12], [31, 35, 5, 0.12]];
  var unreachable = 0;
  for (var u = 0; u < nodes.n; u++) {
    if (nodes.anchor[u]) continue;
    for (var w = 0; w < weatherCentres.length; w++) {
      var c = weatherCentres[w];
      if (Math.abs(nodes.lat[u] - c[0]) < c[2] && Math.abs(nodes.lon[u] - c[1]) < c[2] * 1.5 && R() < c[3]) { nodes.flags[u] |= 8; unreachable++; break; }
    }
  }
  for (var z = 0; z < 153 - unreachable; z++) { var xx = Math.floor(R() * nodes.n); if (!nodes.anchor[xx]) nodes.flags[xx] |= 8; }
  for (var rk = 0; rk < 11; rk++) { var xr = Math.floor(R() * nodes.n); if (!nodes.anchor[xr]) nodes.flags[xr] |= 4; }

  /* sites: key = rounded coordinate */
  var siteMap = {}; var sites = [];
  for (var s2 = 0; s2 < nodes.n; s2++) {
    var key = nodes.lat[s2].toFixed(2) + ',' + nodes.lon[s2].toFixed(2);
    var si = siteMap[key];
    if (si == null) { si = siteMap[key] = sites.length; sites.push({ id: si, lat: nodes.lat[s2], lon: nodes.lon[s2], hub: nodes.hub[s2], n: 0, t: [0, 0, 0] }); }
    sites[si].n++; sites[si].t[nodes.tier[s2]]++;
    nodes.site = nodes.site || []; nodes.site[s2] = si;
  }
  D.nodes = nodes; D.hosts = hosts; D.sites = sites; D.anchorIdx = {};
  Object.keys(A).forEach(function (k) { D.anchorIdx[k] = A[k].idx; });
  D.A = A;
  D.hubByName = hubByName;
  /* the 3 next payees + producer for the landing demo (block 2,996,930) */
  D.landing = {
    height: 2996930, producer: A.prod.idx,
    payees: [{ node: A.winC.idx, tier: 0, amount: 1.0 }, { node: A.winN.idx, tier: 1, amount: 3.5 }, { node: A.winS.idx, tier: 2, amount: 9.0 }],
    fund: 0.5
  };
  /* an app with many instances for the constellation scene (illustrative positions) */
  D.ethInstances = []; (function () { var seen = {}; while (D.ethInstances.length < 30) { var x = Math.floor(R() * nodes.n); if (seen[x]) continue; if (nodes.tier[x] === 0 && R() > 0.2) continue; seen[x] = 1; D.ethInstances.push(x); } })();

  /* ---------- blocks (real: fixtures explorer insight_blocks_latest10) ---------- */
  var prodPool = [
    ['213.32.246.1', 16137, 0, 'Copenhagen'], ['65.109.63.147', 16147, 1, 'Helsinki'], ['135.148.27.2', 16187, 0, 'Reston'], ['91.226.198.155', 16127, 2, 'Vilnius'],
    ['37.27.130.149', 16157, 2, 'Helsinki'], ['78.46.36.181', 16127, 1, 'Falkenstein'], ['62.107.25.252', 16137, 0, 'Copenhagen'], ['149.154.176.46', 16127, 2, 'Frankfurt'],
    ['38.247.82.137', 16187, 1, 'Raleigh'], ['2.233.105.200', 16187, 1, 'Milan']
  ];
  var bl = [[2996929, 1790797594, 3600, 17, 'd8fb2d7487bd778a'], [2996928, 1790797564, 3827, 18, 'be732d697d68dcc5'], [2996927, 1790797504, 2238, 10, 'eb70548f637aaf5c'],
    [2996926, 1790797474, 3255, 15, '2dc2358c9e65fc21'], [2996925, 1790797444, 1835, 8, 'd5273a8768ec6cac'], [2996924, 1790797414, 2851, 13, '9cb94c1884b267bc'],
    [2996923, 1790797384, 3411, 16, 'be63eb375e1e2fca'], [2996922, 1790797354, 1833, 8, 'cf0e92ace406f19f'], [2996921, 1790797324, 2023, 9, '6e8232045168907e'],
    [2996920, 1790797298, 1848, 8, '78a2705cda53cc22']];
  D.blocks = bl.map(function (b, i) { var p = prodPool[i % prodPool.length]; return { h: b[0], time: b[1], size: b[2], tx: b[3], hash: b[4], prod: { ip: p[0], port: p[1], tier: p[2], city: p[3] } }; });

  /* ---------- feed seeds ---------- */
  D.feed = [
    { kind: 'version', cls: 'p2', text: 'FluxOS 8.20.0 on 99.9% of nodes', meta: '6,565 of 6,571 reachable', age: 312 },
    { kind: 'leave', cls: 'p2', text: 'Node expired, no check-in for 640 blocks', meta: '213.32.246.9:16167', tier: 0, age: 168 },
    { kind: 'app-pending', cls: 'p2', text: 'Update pending, EthereumNodeSnap', meta: 'seen 41 s ago, not yet mined', age: 41 },
    { kind: 'join', cls: 'p2', text: 'Node joined, Stratus in Falkenstein', meta: '162.55.4.10:16167', tier: 2, age: 34 },
    { kind: 'app', cls: 'p2', text: 'Fluxtracker updated, 2 instances', meta: 'spec v6, 6.48 FLUX', age: 27 },
    { kind: 'heartbeat', cls: 'p3', text: 'Confirmed 14 nodes', meta: 'block 2,996,929', age: 16 },
    { kind: 'block', cls: 'p0', text: 'Block 2,996,929 produced', meta: '213.32.246.1:16137, 17 tx, 3.6 KB', tier: 0, age: 12 },
    { kind: 'mine', cls: 'p1', text: 'Watched node is next in line', meta: '65.109.26.93:16147, Stratus, 9.00 FLUX', tier: 2, age: 12 }
  ];

  /* ---------- node inspector: hero (nodes.json + fixtures) ---------- */
  D.heroInfo = {
    ip: '65.109.26.93', port: 16147, tier: 2, status: 'ok', arcane: true,
    city: 'Helsinki', region: 'Uusimaa', cc: 'FI', country: 'Finland', org: 'Hetzner Online GmbH', asn: 'AS24940', hosting: true,
    lat: 60.1719, lon: 24.9347,
    rank: 0, queue: 1764, lastPaid: 2995211, lastConfirmed: 2996913, added: 2846353, confirmed: 2846356,
    collateral: '03167acd7621d4e01f97652c984e0f151b40e937d4b477f431babd51b0b9a216', vout: 0, amount: 40000,
    pay: heroPay, activeSince: 1786273744,
    /* benchmark values are the Stratus sample from fixtures/flux/benchmark_getbenchmarks.json (node 94.130.137.2) */
    bench: { cores: 16, ram: 61, ssd: 890, eps: 4701.77, down: 948.99, up: 969.08, ping: 61, ddwrite: 744, version: '1.0.20', secure: true, illustrative: true },
    versions: { fluxos: '8.20.0', daemon: '9.1.0', bench: '1.0.20' },
    peers: { out: 18, inc: 21 },
    apps: [{ name: 'EthereumNodeLight', comps: 1 }, { name: 'Fluxtracker', comps: 2 }, { name: 'FluxExport', comps: 1 }, { name: 'BitcoinWhitepaper', comps: 1 }, { name: 'archivebox', comps: 1 }, { name: 'Doccano', comps: 3 }],
    uptimePct: 99.62, payments30d: 49, earned30d: 441.0
  };

  /* ---------- transaction (insight_tx_regular.json, block 2,996,907) ---------- */
  D.tx = {
    txid: '8aa97365b148e2125de355988b4c1be4870edc0e869587f831f8c0d65871beec', blockHeight: 2996907,
    blockHash: '9654494e12447ea90f69fd57abfb13a376ec09f9375a0252aa3ea757e74b3597', time: 1790796964, size: 245, version: 4, locktime: 0,
    valueIn: 58.71086756, valueOut: 58.71086726, fee: 0.0000003, confirmationsAtTip: 22,
    vin: [{ addr: 't1K7rsxfnXctSJ1uqLFR5RKJAg6PhGk7Ebv', value: 58.71086756, prev: 'ac77f238157ec8d9709eac1b23927a9bdbb43c97ec68b59e8672d936823b314d', n: 1 }],
    vout: [{ addr: 't1gVLzgzgp9iG13qtzjY2fHv65FnTHePUTq', value: 0.13937905, n: 0, type: 'pubkeyhash' }, { addr: 't1K7rsxfnXctSJ1uqLFR5RKJAg6PhGk7Ebv', value: 58.57148821, n: 1, type: 'pubkeyhash', change: true }]
  };

  /* ---------- app: BitcoinWhitepaper (permanentmessages + location fixtures) ---------- */
  D.app = {
    name: 'BitcoinWhitepaper', version: 3, owner: '196GJWyLxzAw3MirTT7Bqs2iGpUQio29GH', instances: 3, running: 3,
    desc: 'A Global Deployment of the Bitcoin Whitepaper for Data Retention Purposes on the FluxOS Network',
    comps: [{ name: 'BitcoinWhitepaper', image: 'littlestache/bitcoinwhitepaper:latest', ports: '35051 to 80', domains: 'none', cpu: 0.1, ram: 100, ssd: 1 }],
    lastHeight: 2994014, expireBlocks: 88000, registered: 893852,
    history: [
      { type: 'register', h: 893852, date: '2021-07-01', paid: 4.5, spec: 'v2' },
      { type: 'renew', n: 4, h: 950656, date: '2021-07-22 to 2021-09-18', paid: [3.06, 3.47, 1.0, 4.1] },
      { type: 'update', h: 2687710, date: '2026-06-15', paid: 17.77, spec: 'v2 to v3', diff: [['version', '2', '3'], ['instances', null, '3']] },
      { type: 'renew', n: 4, h: 2994014, date: '2026-07-11 to 2026-09-29', paid: [20.76, 24.04, 19.39, 12.96] }
    ],
    totalPaid: 111.05
  };

  /* ---------- operator (nodes.json): address with 7 nodes on one host ---------- */
  D.operator = { addr: heroPay, nodes: heroHost.map(function (n, i) { return { port: n[0], tier: n[1], rank: n[2], paid: n[4], idx: D.heroHost[i].idx }; }) };
  D.operator.nodes.sort(function (a, b) { return a.rank - b.rank; });
})();
