/* Flux Atlas design mock: window templates. Real values from fixtures where available (see data.js). */
(function () {
  'use strict';
  var D = window.ATLAS_DATA, I = window.atlasIcon;
  var V = (window.ATLAS_VIEWS = {});

  /* ---------- helpers ---------- */
  var f0 = function (n) { return Math.round(n).toLocaleString('en-US'); };
  var f2 = function (n) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var f8 = function (n) { return n.toLocaleString('en-US', { minimumFractionDigits: 8, maximumFractionDigits: 8 }); };
  var tierName = ['cumulus', 'nimbus', 'stratus'], tierLabel = ['Cumulus', 'Nimbus', 'Stratus'];
  var tierVar = function (t) { return 'var(--tier-' + tierName[t] + ')'; };
  var mid = function (s, a, b) { return s.length > a + b + 1 ? s.slice(0, a) + '…' + s.slice(-b) : s; };
  V.f0 = f0; V.f2 = f2; V.f8 = f8; V.mid = mid;
  var cp = '<button class="cp" title="Copy" aria-label="Copy">' + I('copy', { size: 13 }) + '</button>';
  var chipTier = function (t, label) { return '<span class="chip chip--tier" data-tier="' + tierName[t] + '">' + window.atlasTier(tierName[t], 13) + (label || tierLabel[t]) + '</span>'; };
  V.chipTier = chipTier;

  function spark(vals, w, h, color, area) {
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), rng = (mx - mn) || 1, n = vals.length, pts = [];
    for (var i = 0; i < n; i++) pts.push([i / (n - 1) * (w - 6) + 3, h - 3 - (vals[i] - mn) / rng * (h - 8)]);
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var last = pts[n - 1];
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" fill="none">' +
      (area ? '<path d="' + d + ' L' + last[0] + ' ' + h + ' L3 ' + h + ' Z" fill="' + color + '" opacity=".12"/>' : '') +
      '<path d="' + d + '" stroke="' + color + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3.2" fill="' + color + '" stroke="var(--ink-1)" stroke-width="2"/></svg>';
  }
  V.spark = spark;

  /* ---------- window chrome ---------- */
  V.chrome = function (o) {
    return '<div class="win-wrap' + (o.focus ? ' is-focus' : '') + '" id="' + o.id + '" ' + (o.tier ? 'data-tier="' + o.tier + '"' : '') + ' ' + (o.accent ? 'data-accent="' + o.accent + '"' : '') +
      ' style="left:' + o.x + 'px;top:' + o.y + 'px;width:' + o.w + 'px;height:' + o.h + 'px;z-index:' + (o.z || 41) + '">' +
      '<section class="win" aria-label="' + o.title + '">' +
      '<header class="win-bar"><span class="ap">' + o.glyph + '</span><div class="ttl"><b' + (o.mono ? ' class="mono"' : '') + '>' + o.title + '</b><small>' + o.sub + '</small></div>' +
      '<span class="fresh" data-fresh="' + (o.fresh || 'tip') + '">' + (o.freshText || '4 s') + '</span>' +
      '<div class="ctl"><button title="Dock or float" aria-label="Dock or float">' + I('pin', { size: 15 }) + '</button><button title="Pop out" aria-label="Pop out">' + I('square-arrow-out-up-right', { size: 15 }) + '</button><button title="Minimize" aria-label="Minimize">' + I('minus', { size: 15 }) + '</button><button class="close" title="Close" aria-label="Close">' + I('x', { size: 15 }) + '</button></div></header>' +
      (o.tabs ? '<div class="win-tabs" role="tablist">' + o.tabs.map(function (t, i) { return '<button role="tab" class="' + (i === (o.tabOn || 0) ? 'on' : '') + '">' + t + '</button>'; }).join('') + '</div>' : '') +
      '<div class="win-body">' + o.body + '</div></section></div>';
  };

  /* ---------- node inspector ---------- */
  var CC = { FI: 'Finland', DE: 'Germany', FR: 'France', GB: 'United Kingdom', NL: 'Netherlands', DK: 'Denmark', PL: 'Poland', LT: 'Lithuania', IT: 'Italy', ES: 'Spain', CH: 'Switzerland', SE: 'Sweden', NO: 'Norway', CZ: 'Czechia', RU: 'Russia', UA: 'Ukraine', PT: 'Portugal', US: 'United States', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', AR: 'Argentina', CL: 'Chile', CO: 'Colombia', SG: 'Singapore', JP: 'Japan', KR: 'South Korea', HK: 'Hong Kong', IN: 'India', AE: 'United Arab Emirates', TR: 'Turkey', IL: 'Israel', AU: 'Australia', NZ: 'New Zealand', ZA: 'South Africa', NG: 'Nigeria', KE: 'Kenya', TH: 'Thailand', ID: 'Indonesia', PH: 'Philippines', TW: 'Taiwan', EG: 'Egypt', AT: 'Austria', BE: 'Belgium', IE: 'Ireland', RO: 'Romania', HU: 'Hungary' };
  var TOTALS = [3378, 1582, 1764], REWARD = [1, 3.5, 9], CYCLE = [28, 13.2, 14.7];
  function etaText(rank) { var s = rank * 30; return rank < 1 ? 'Next block' : (s < 90 ? Math.round(s) + ' s' : (s < 3600 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1) + ' h')); }
  /* any node on the globe: hero data for the hero, a consistent derivation for everything else */
  function nodeInfo(idx) {
    var N = D.nodes, hero = D.heroInfo;
    if (idx == null || idx === D.hero.idx) return { hero: true, idx: D.hero.idx, ip: hero.ip, port: hero.port, t: 2, city: hero.city, loc: hero.city + ', ' + hero.region + ', ' + hero.country, org: hero.org + ' &middot; ' + hero.asn, type: 'Datacenter', rank: 0, total: 1764, pay: hero.pay, host: D.heroHost.map(function (o) { return { port: o.port, tier: o.tier, rank: o.rank }; }), apps: hero.apps, uptime: '99.62%' };
    var t = N.tier[idx], hub = D.hubs[N.hub[idx]], rank = N.rank[idx] >= 0 ? N.rank[idx] : ((idx * 2654435761) >>> 0) % TOTALS[t], sib = D.hosts[N.host[idx]].nodes;
    return { hero: false, idx: idx, ip: N.ip[idx], port: N.port[idx], t: t, city: hub.name, loc: hub.name + ', ' + (CC[hub.cc] || hub.cc), org: (hub.org === 'Various' ? 'Independent operator' : hub.org), type: hub.type === 'dc' ? 'Datacenter' : 'Residential', rank: rank, total: TOTALS[t],
      pay: 't1' + (N.ip[idx].replace(/\./g, '') + 'QWsptPPWxQ7iFhb1eG9Pv6Aq5g9').slice(0, 33), host: sib.map(function (j) { return { port: N.port[j], tier: N.tier[j], rank: N.rank[j] >= 0 ? N.rank[j] : ((j * 2654435761) >>> 0) % TOTALS[N.tier[j]] }; }), apps: hero.apps.slice(0, 1 + idx % 5), uptime: (99.2 + (idx % 7) / 10).toFixed(2) + '%' };
  }
  V.nodeInfo = nodeInfo;
  V.node = function (x, y, w, h, idx) {
    var n = D.heroInfo, q = nodeInfo(idx), t = q.t, tn = tierName[t], lastPaid = q.hero ? 1718 : Math.max(0, TOTALS[t] - q.rank - 40), pay30 = q.hero ? 49 : Math.round(720 / CYCLE[t] * 0.98);
    var ladder = '', byPort = {}; q.host.forEach(function (o) { byPort[o.port] = o; });
    for (var p = 16127; p <= 16197; p += 10) {
      var o = byPort[p];
      if (o) { ladder += '<div class="slot used' + (p === q.port ? ' sel' : '') + '" data-tier="' + tierName[o.tier] + '" title="' + q.ip + ':' + p + '">' + window.atlasTier(tierName[o.tier], 14) + '<span>' + p + '</span><small>#' + f0(o.rank + 1) + '</small></div>'; }
      else ladder += '<div class="slot free"><span>' + p + '</span><small>free</small></div>';
    }
    var pay7 = [3, 5, 2, 9, 4, 6, 7, 3, 8, 5, 9, 6, 4, 7, 9, 5, 6, 8, 9, 7, 6, 9, 8, 9, 7, 9, 8, 9, 9, 9];
    var bars = pay7.map(function (v, i) { return '<i style="height:' + (4 + ((v + (q.hero ? 0 : q.idx + i)) % 10) * 1.6) + 'px"></i>'; }).join('');
    var peersSvg = (function () {
      var out = D.peers.filter(function (p) { return p.dir === 'out'; }), inn = D.peers.filter(function (p) { return p.dir === 'in'; }), s = '<svg viewBox="0 0 112 112"><circle cx="56" cy="56" r="44" fill="none" stroke="rgb(255 255 255 / .06)"/><circle cx="56" cy="56" r="26" fill="none" stroke="rgb(255 255 255 / .05)"/>';
      out.forEach(function (p, i) { var a = i / out.length * Math.PI * 2 - Math.PI / 2, r = 44; s += '<line x1="56" y1="56" x2="' + (56 + Math.cos(a) * r).toFixed(1) + '" y2="' + (56 + Math.sin(a) * r).toFixed(1) + '" stroke="rgb(134 161 218 / .28)"/><circle cx="' + (56 + Math.cos(a) * r).toFixed(1) + '" cy="' + (56 + Math.sin(a) * r).toFixed(1) + '" r="2.4" fill="#86a1da"/>'; });
      inn.forEach(function (p, i) { var a = i / inn.length * Math.PI * 2 - Math.PI / 2 + 0.08, r = 26; s += '<circle cx="' + (56 + Math.cos(a) * r).toFixed(1) + '" cy="' + (56 + Math.sin(a) * r).toFixed(1) + '" r="2.1" fill="none" stroke="#86a1da" stroke-width="1.1"/>'; });
      return s + '<circle cx="56" cy="56" r="6" fill="var(--hot)"/><circle cx="56" cy="56" r="10" fill="none" stroke="rgb(255 255 255 / .5)"/></svg>';
    })();
    var uptime = ''; for (var u = 0; u < 90; u++) uptime += '<i class="' + (u === 31 || u === 32 ? 'gap' : (u < 6 ? 'none' : '')) + '"></i>';
    var sameOp = q.host.length > 1, nUsed = q.host.length;
    var payBig = q.rank === 0 ? '<b id="pay-eta">Next block</b>' : '<b>in ' + etaText(q.rank) + '</b>';
    var body =
      '<div class="idstrip">' +
        '<div class="row">' + chipTier(t) + '<span class="chip chip--status" data-status="ok"><i class="dot"></i>Confirmed</span><span class="chip"><span style="color:var(--accent-400)">' + I('arcane', { size: 13 }) + '</span>ArcaneOS</span><span class="chip">' + I(q.type === 'Datacenter' ? 'server' : 'house', { size: 13 }) + q.type + '</span></div>' +
        '<div class="loc">' + I('map-pin', { size: 15 }) + '<span>' + q.loc + '</span><small>' + q.org + '</small></div>' +
        '<div class="actions"><button class="btn btn--sm">' + I('locate-fixed', { size: 14 }) + 'Fly to</button><button class="btn btn--sm">' + I('eye', { size: 14 }) + 'Watch</button><button class="btn btn--sm">' + I('copy', { size: 14 }) + 'Copy</button><button class="btn btn--sm">' + I('user-round-check', { size: 14 }) + 'Operator</button></div>' +
      '</div>' +
      '<div class="sec"><div class="paytile" data-tier="' + tn + '"><div class="k">' + I('coins', { size: 14 }) + 'Next payment</div>' +
        '<div class="big">' + payBig + '<em>+' + f2(REWARD[t]) + ' FLUX</em></div>' +
        '<div class="sub">Queue position <span class="mono">#' + f0(q.rank + 1) + ' of ' + f0(q.total) + '</span> &middot; last paid <span class="mono">' + f0(lastPaid) + '</span> blocks ago (block <span class="mono">' + f0(D.clock.tip - lastPaid) + '</span>)</div>' +
        '<div class="bar"><i></i></div></div>' +
        '<div class="grid3" style="margin-top:8px"><div class="tile"><div class="k">30 days</div><div class="v">' + pay30 + '<small>payments</small></div><div class="d">' + f2(pay30 * REWARD[t]) + ' FLUX</div></div>' +
        '<div class="tile"><div class="k">Per day</div><div class="v">' + f2(24 / CYCLE[t] * REWARD[t]).replace(/\.00$/, '') + '<small>FLUX</small></div><div class="d up">cycle ' + CYCLE[t] + ' h</div></div>' +
        '<div class="tile"><div class="k">Payout history</div><div class="v" style="height:26px;display:flex;align-items:flex-end;gap:2px"><span class="barsv" style="display:flex;align-items:flex-end;gap:1.5px;height:26px">' + bars + '</span></div><div class="d">30 d</div></div></div></div>' +
      '<div class="sec"><h3>Host ' + q.ip + '<span class="aside">' + I('network', { size: 14 }) + nUsed + ' of 8 ports in use</span></h3><div class="ladder">' + ladder + '</div>' +
        '<p class="cap" style="margin:10px 0 0">' + (sameOp ? 'All ' + nUsed + ' nodes pay <span class="mono">' + mid(q.pay, 6, 4) + '</span>. One host, one point of failure. <a href="#">View operator</a>' : 'One node on this host. <a href="#">View operator</a>') + '</p></div>' +
      '<div class="sec"><h3>Health<span class="aside"><span class="mono">uptime ' + q.uptime + '</span> (90 d)</span></h3>' +
        '<div class="stepper" style="--prog:40%"><div class="stp done"><i>' + I('check', { size: 12, sw: 2.2 }) + '</i>Started<small>2,846,353</small></div><div class="stp done"><i>' + I('check', { size: 12, sw: 2.2 }) + '</i>Joined<small>2,846,356</small></div><div class="stp now"><i>' + I('activity', { size: 12, sw: 2 }) + '</i>Heartbeat<small>every ~4.2 h</small></div><div class="stp"><i>' + I('triangle-alert', { size: 12 }) + '</i>At risk<small>560 blocks</small></div><div class="stp"><i>' + I('octagon-x', { size: 12 }) + '</i>Expired<small>640 blocks</small></div></div>' +
        '<div class="row" style="justify-content:space-between;margin-bottom:2px"><span class="cap">Last check-in</span><span class="mono" style="font-size:12px"><b' + (q.hero ? ' id="checkin"' : '') + '>' + (q.hero ? 16 : 40 + (q.idx % 400)) + '</b> blocks ago <span class="dim">(8 min)</span></span></div>' +
        '<div class="gauge"' + (q.hero ? ' id="gauge"' : '') + ' style="--at:' + (q.hero ? 2.5 : ((40 + (q.idx % 400)) / 640 * 100).toFixed(1)) + '%"><span class="mk"></span></div><div class="gauge-l"><span>0</span><span style="margin-left:50%">500 due</span><span>560</span><span>640</span></div>' +
        '<div class="uptime" title="90 days, one cell per day">' + uptime + '</div></div>' +
      '<div class="sec"><h3>Hardware<span class="aside">benchmark ' + n.bench.version + ', passing</span></h3><div class="grid2">' +
        '<div class="tile"><div class="k">CPU</div><div class="v">' + n.bench.cores + '<small>cores</small></div><div class="d">' + f0(n.bench.eps) + ' eps</div><div class="meter locked"><i style="width:11%"></i></div></div>' +
        '<div class="tile"><div class="k">Memory</div><div class="v">' + n.bench.ram + '<small>GB</small></div><div class="d">locked by apps 9%</div><div class="meter locked"><i style="width:9%"></i></div></div>' +
        '<div class="tile"><div class="k">SSD</div><div class="v">' + n.bench.ssd + '<small>GB</small></div><div class="d">' + n.bench.ddwrite + ' MB/s write</div><div class="meter locked"><i style="width:14%"></i></div></div>' +
        '<div class="tile"><div class="k">Network</div><div class="v">' + f0(n.bench.down) + '<small>Mbps down</small></div><div class="d">' + f0(n.bench.up) + ' up &middot; ' + n.bench.ping + ' ms</div></div></div>' +
        '<p class="cap" style="margin:8px 0 0">Bars show capacity locked by running apps.' + (q.hero ? '' : ' Sample values.') + '</p></div>' +
      '<div class="sec"><h3>Mesh<span class="aside">' + n.peers.out + ' out &middot; ' + n.peers.inc + ' in</span></h3><div class="peers">' + peersSvg +
        '<div class="plist"><div class="row"><span class="cap grow">Reveal peers on the globe</span><span class="switch on"></span></div>' +
        D.peers.slice(0, 3).map(function (p) { return '<div class="p"><span class="mono">' + p.ip + '</span><span class="dim">' + p.city + '</span><em>' + p.ms + ' ms</em></div>'; }).join('') + '</div></div></div>' +
      '<div class="sec"><h3>Apps<span class="aside">' + q.apps.length + ' running</span></h3><div class="apps-chips">' + q.apps.map(function (a) { return '<span class="appchip">' + I('boxes', { size: 13 }) + a.name + '<small>' + a.comps + '</small></span>'; }).join('') + '</div></div>' +
      '<div class="sec"><h3>Collateral and versions</h3><dl class="kv">' +
        '<dt>Collateral</dt><dd>' + (t === 0 ? '1,000' : (t === 1 ? '12,500' : '40,000')) + ' FLUX</dd>' +
        '<dt>Outpoint</dt><dd><span class="t">' + mid(n.collateral, 8, 6) + ':' + n.vout + '</span>' + cp + '</dd>' +
        '<dt>Added</dt><dd>block ' + f0(n.added) + '</dd><dt>Confirmed</dt><dd>block ' + f0(n.confirmed) + '</dd>' +
        '<dt>Last confirmed</dt><dd>block ' + f0(n.lastConfirmed) + '</dd>' +
        '<dt>Payment address</dt><dd><span class="t">' + mid(q.pay, 8, 5) + '</span>' + cp + '</dd>' +
        '<dt>FluxOS</dt><dd class="sans">8.20.0 <span class="chip chip--status" data-status="ok" style="height:18px;font-size:10.5px"><i class="dot"></i>latest</span></dd>' +
        '<dt>Daemon</dt><dd>9.1.0</dd><dt>Active since</dt><dd>2026-08-05</dd></dl></div>';
    return V.chrome({ id: 'win-node', x: x, y: y, w: w, h: h, tier: tn, focus: true, mono: true, title: q.ip + ':' + q.port, sub: 'Node &middot; ' + tierLabel[t] + ' &middot; ' + q.city, glyph: window.atlasTier(tn, 16), body: body, fresh: 'nodes', freshText: '4 s' });
  };

  /* ---------- explorer: transaction ---------- */
  V.tx = function (x, y, w, h) {
    var t = D.tx;
    var bodyFlow = (function () {
      var W = 780, H = 240, ins = t.vin, outs = t.vout, tot = t.valueIn, sc = 104 / tot, x0 = 196, x1 = 574, id = 'fl' + Math.floor(Math.random() * 1e6);
      var th = [Math.max(7, outs[0].value * sc), outs[1].value * sc, 3];
      var sy = [20, 20 + th[0] + 4, 20 + th[0] + 4 + th[1] + 4];          /* band tops at the source strip */
      var cardY = [0, 76, 196], cardH = [66, 112, 40];
      var dy = [cardY[0] + cardH[0] / 2 - th[0] / 2, cardY[1] + cardH[1] / 2 - th[1] / 2, cardY[2] + cardH[2] / 2 - th[2] / 2];
      var band = function (a0, b0, h, fill, op, extra) { var mx = (x0 + x1) / 2; return '<path d="M' + x0 + ' ' + a0 + ' C' + mx + ' ' + a0 + ' ' + mx + ' ' + b0 + ' ' + x1 + ' ' + b0 + ' L' + x1 + ' ' + (b0 + h) + ' C' + mx + ' ' + (b0 + h) + ' ' + mx + ' ' + (a0 + h) + ' ' + x0 + ' ' + (a0 + h) + ' Z" fill="' + fill + '" opacity="' + op + '"' + (extra || '') + '/>'; };
      var s = '<defs><linearGradient id="' + id + 'a" x1="0" x2="1"><stop offset="0" stop-color="var(--accent-500)" stop-opacity=".95"/><stop offset="1" stop-color="var(--accent-300)" stop-opacity=".95"/></linearGradient>' +
        '<linearGradient id="' + id + 'b" x1="0" x2="1"><stop offset="0" stop-color="var(--accent-600)" stop-opacity=".55"/><stop offset="1" stop-color="var(--accent-600)" stop-opacity=".16"/></linearGradient></defs>';
      s += band(sy[1], dy[1], th[1], 'url(#' + id + 'b)', 1);
      s += band(sy[0], dy[0], th[0], 'url(#' + id + 'a)', 1);
      s += '<path d="M' + x0 + ' ' + (sy[2] + 1.5) + ' C ' + ((x0 + x1) / 2) + ' ' + (sy[2] + 1.5) + ' ' + ((x0 + x1) / 2) + ' ' + (dy[2] + 1.5) + ' ' + x1 + ' ' + (dy[2] + 1.5) + '" stroke="var(--hot)" stroke-width="2" fill="none" stroke-dasharray="3 4" opacity=".85"/>';
      /* input card */
      s += '<rect x="0" y="6" width="190" height="' + (sy[2] + 14) + '" rx="14" fill="var(--ink-0)" stroke="var(--line-2)"/>' +
        '<text class="sm" x="16" y="30">Input</text><text class="big" x="16" y="52">' + mid(ins[0].addr, 7, 5) + '</text>' +
        '<text x="16" y="74">' + f8(ins[0].value) + '</text><text class="sm" x="16" y="98">Spends output ' + ins[0].n + '</text><text class="sm" x="16" y="113">of ' + mid(ins[0].prev, 6, 4) + '</text>';
      var card = function (i, label, addr, val, stroke) { return '<rect x="' + x1 + '" y="' + cardY[i] + '" width="206" height="' + cardH[i] + '" rx="12" fill="var(--ink-0)" stroke="' + stroke + '"/>' +
        '<text class="sm" x="' + (x1 + 14) + '" y="' + (cardY[i] + 20) + '">' + label + '</text>' + (addr ? '<text class="big" x="' + (x1 + 14) + '" y="' + (cardY[i] + 40) + '">' + addr + '</text>' : '') + '<text x="' + (x1 + 14) + '" y="' + (cardY[i] + (addr ? 55 : 35)) + '"' + (val.hot ? ' style="fill:var(--hot)"' : '') + '>' + val.t + '</text>'; };
      s += card(0, 'Recipient, output 0', mid(outs[0].addr, 7, 5), { t: f8(outs[0].value) }, 'rgb(134 161 218 / .6)');
      s += card(1, 'Change, output 1, back to the sender', mid(outs[1].addr, 7, 5), { t: f8(outs[1].value) }, 'var(--line-2)');
      s += card(2, 'Network fee', '', { t: f8(t.fee), hot: true }, 'rgb(255 255 255 / .4)');
      s += '<text x="' + ((x0 + x1) / 2) + '" y="' + (dy[1] + th[1] / 2 + 4) + '" text-anchor="middle" style="fill:var(--text-2);font-family:var(--font-sans);font-size:12px">Change returns to the sender</text>';
      return '<div class="flow"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Value flow: one input of 58.71086756 FLUX, a recipient output of 0.13937905, change of 58.57148821 and a fee of 0.0000003">' + s + '</svg></div>';
    })();
    var body =
      '<div class="txhead"><div class="id"><span class="grow">' + t.txid + '</span><button class="btn btn--sm btn--icon" aria-label="Copy transaction id">' + I('copy', { size: 14 }) + '</button></div>' +
        '<div class="row wrap"><span class="chip chip--status" data-status="ok"><i class="dot"></i><span id="tx-conf">' + (t.confirmationsAtTip) + '</span> confirmations</span><span class="chip">' + I('arrow-left-right', { size: 13 }) + 'Transfer</span><span class="chip chip--mono">Block ' + f0(t.blockHeight) + '</span><span class="chip">' + I('clock', { size: 13 }) + '2026-09-30 19:36:04 UTC</span><span class="when">' + '<span id="tx-ago">10 min ago</span></span></div></div>' +
      '<div class="txtiles"><div class="tile"><div class="k">Value out</div><div class="v">58.71<small>FLUX</small></div><div class="d">$4.38</div></div>' +
        '<div class="tile"><div class="k">Fee</div><div class="v">0.0000003<small>FLUX</small></div><div class="d">1.2 sat per byte</div></div>' +
        '<div class="tile"><div class="k">Size</div><div class="v">245<small>bytes</small></div><div class="d">1 in, 2 out</div></div>' +
        '<div class="tile"><div class="k">Confirmed in</div><div class="v">30<small>s</small></div><div class="d">first block</div></div></div>' +
      '<div class="flowbox"><h4>' + I('git-compare', { size: 15 }) + 'Where the value went<span class="aside">band width is proportional to amount</span></h4>' + bodyFlow + '</div>' +
      '<div class="detail"><dl class="kv" style="grid-template-columns:auto 1fr;gap:9px 24px;font-size:12.5px">' +
        '<dt>Block hash</dt><dd><span class="t">' + t.blockHash + '</span>' + cp + '</dd>' +
        '<dt>Version</dt><dd class="sans">4, overwintered, group 0x892f2085</dd><dt>Locktime</dt><dd>0</dd><dt>Expiry height</dt><dd class="sans">none</dd>' +
        '<dt>Input detail</dt><dd><span class="t">' + t.vin[0].prev + ':' + t.vin[0].n + '</span>' + cp + '</dd></dl></div>';
    return V.chrome({ id: 'win-tx', x: x, y: y, w: w, h: h, accent: 'chain', focus: true, title: 'Transaction', sub: mid(t.txid, 8, 6), glyph: I('arrow-left-right', { size: 16 }), tabs: ['Overview', 'Inputs and outputs', 'Raw'], body: body, fresh: 'tip', freshText: 'now' });
  };

  /* ---------- app inspector ---------- */
  V.app = function (x, y, w, h) {
    var a = D.app, blocksLeft = a.lastHeight + a.expireBlocks - D.clock.tip;
    var days = blocksLeft * 30 / 86400, ring = (function () {
      var C = 2 * Math.PI * 36, frac = blocksLeft / a.expireBlocks;
      return '<div class="ring"><svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="36" fill="none" stroke="var(--ink-3)" stroke-width="6"/><circle cx="42" cy="42" r="36" fill="none" stroke="url(#ex)" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + (C * frac).toFixed(1) + ' ' + C.toFixed(1) + '"/><defs><linearGradient id="ex"><stop offset="0" stop-color="var(--accent-500)"/><stop offset="1" stop-color="var(--hot)"/></linearGradient></defs></svg><div class="c"><div><b>' + Math.floor(days) + 'd</b><small>left</small></div></div></div>';
    })();
    var hist = a.history.map(function (h) {
      if (h.type === 'register') return '<div class="hi register"><div class="t">Registered<time>' + h.date + '</time></div><div class="m">Block <span class="mono">' + f0(h.h) + '</span> &middot; paid <span class="mono">' + f2(h.paid) + ' FLUX</span> &middot; spec v2</div></div>';
      if (h.type === 'renew') return '<div class="hi renew"><div class="t">Renewed ' + h.n + ' times<time>' + h.date + '</time></div><div class="m">Same spec each time &middot; <span class="mono">' + h.paid.map(f2).join(', ') + '</span> FLUX</div></div>';
      return '<div class="hi update"><div class="t">Spec updated<time>' + h.date + '</time></div><div class="m">Block <span class="mono">' + f0(h.h) + '</span> &middot; paid <span class="mono">' + f2(h.paid) + ' FLUX</span></div>' +
        '<div class="diff"><div class="ctx">{ "name": "BitcoinWhitepaper",</div><div class="del">"version": 2,</div><div class="add">"version": 3,</div><div class="add">"instances": 3,</div><div class="ctx">  "cpu": 0.1, "ram": 100, "hdd": 1 }</div></div></div>';
    }).reverse().join('');
    var body =
      '<div class="sec"><div class="hero-exp">' + ring + '<div><div class="row wrap" style="margin-bottom:6px"><span class="chip chip--status" data-status="ok"><i class="dot"></i>Running</span><span class="chip">Spec v3</span><span class="chip">1 component</span></div><div class="cap" style="font-size:12.5px;color:var(--text-2)">' + a.desc + '</div></div></div>' +
        '<div class="grid3" style="margin-top:12px"><div class="tile"><div class="k">Instances</div><div class="v">3<small>of 3</small></div><div class="d up">all running</div></div><div class="tile"><div class="k">Expires</div><div class="v">' + Math.floor(days) + '<small>d ' + Math.floor((days % 1) * 24) + 'h</small></div><div class="d">block ' + f0(a.lastHeight + a.expireBlocks) + '</div></div><div class="tile"><div class="k">Paid, all time</div><div class="v">' + f0(a.totalPaid) + '<small>FLUX</small></div><div class="d">10 messages</div></div></div></div>' +
      '<div class="sec"><h3>Where it runs<span class="aside">3 instances, 2 countries</span></h3><div class="constmap"><canvas id="constmap"></canvas></div>' +
        '<div class="kv" style="margin-top:10px;grid-template-columns:1fr auto auto"><span class="mono" style="font-size:12px">65.21.18.14:16127</span><span class="dim">Helsinki</span><span class="chip chip--tier" data-tier="stratus" style="height:20px">' + window.atlasTier('stratus', 12) + 'Stratus</span>' +
        '<span class="mono" style="font-size:12px">65.108.75.162:16127</span><span class="dim">Helsinki</span><span class="chip chip--tier" data-tier="stratus" style="height:20px">' + window.atlasTier('stratus', 12) + 'Stratus</span>' +
        '<span class="mono" style="font-size:12px">188.250.36.83:16167</span><span class="dim">Maia</span><span class="chip chip--tier" data-tier="cumulus" style="height:20px">' + window.atlasTier('cumulus', 12) + 'Cumulus</span></div></div>' +
      '<div class="sec"><h3>Spec</h3><div class="spec"><span class="dim">Image</span><b class="mono" style="font-size:12px">' + a.comps[0].image + '</b><span class="dim">Ports</span><b class="mono" style="font-size:12px">35051 to 80</b><span class="dim">Resources</span><b class="mono" style="font-size:12px">0.1 CPU &middot; 100 MB &middot; 1 GB</b><span class="dim">Domains</span><b class="mono" style="font-size:12px">none</b><span class="dim">Environment</span><span class="masked">' + I('lock', { size: 13 }) + '0 variables</span><span class="dim">Owner</span><b class="mono" style="font-size:12px">' + mid(a.owner, 7, 5) + '</b></div></div>' +
      '<div class="sec"><h3>History<span class="aside">Spec archaeology, 10 messages</span></h3><div class="hist">' + hist + '</div><p class="cap" style="margin:2px 0 0">Renewals repeat the same spec and are grouped. Only real changes get a diff.</p></div>';
    return V.chrome({ id: 'win-app', x: x, y: y, w: w, h: h, accent: 'app', focus: true, title: a.name, sub: 'App &middot; owner ' + mid(a.owner, 6, 4), glyph: I('boxes', { size: 16 }), body: body, fresh: 'apps', freshText: '41 s' });
  };

  /* ---------- payment queue (wheel) ---------- */
  V.queue = function (x, y, w, h) {
    var cx = 264, cy = 264, rings = [{ t: 0, r: 222, total: 3378 }, { t: 1, r: 178, total: 1582 }, { t: 2, r: 134, total: 1764 }];
    var s = '<svg class="wheel" viewBox="0 0 528 528" width="100%" style="max-width:' + (h - 120) + 'px" role="img" aria-label="Payment queue: one ring per tier; the cursor at the top is the next payee">';
    s += '<defs>';
    rings.forEach(function (rg) { s += '<linearGradient id="rg' + rg.t + '" gradientTransform="rotate(90)"><stop offset="0" stop-color="var(--tier-' + tierName[rg.t] + ')" stop-opacity=".9"/><stop offset="1" stop-color="var(--tier-' + tierName[rg.t] + ')" stop-opacity=".1"/></linearGradient>'; });
    s += '</defs>';
    rings.forEach(function (rg) {
      var C = 2 * Math.PI * rg.r, ticks = 120, dash = (C / ticks);
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + rg.r + '" fill="none" stroke="var(--ink-2)" stroke-width="22"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + rg.r + '" fill="none" stroke="var(--tier-' + tierName[rg.t] + ')" stroke-opacity=".32" stroke-width="22" stroke-dasharray="1.1 ' + (dash - 1.1).toFixed(3) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
      /* front of the queue: a comet arc approaching the cursor from the left (next 6%) */
      var arcLen = C * 0.065;
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + rg.r + '" fill="none" stroke="var(--tier-' + tierName[rg.t] + ')" stroke-width="22" stroke-opacity=".9" stroke-linecap="round" stroke-dasharray="' + arcLen.toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(' + (-90 - 0.065 * 360) + ' ' + cx + ' ' + cy + ')" style="filter:drop-shadow(0 0 8px var(--tier-' + tierName[rg.t] + '))"/>';
    });
    /* operator markers: rank -> angle (clockwise from top) = 360 - rank/total*360 */
    var marks = D.operator.nodes;
    marks.forEach(function (n) {
      var rg = rings[n.tier], ang = (360 - n.rank / rg.total * 360) * Math.PI / 180, px = cx + Math.sin(ang) * rg.r, py = cy - Math.cos(ang) * rg.r;
      s += '<circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="' + (n.rank === 0 ? 9 : 6) + '" fill="var(--ink-0)" stroke="var(--hot)" stroke-width="' + (n.rank === 0 ? 2.2 : 1.6) + '"/><circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="' + (n.rank === 0 ? 3.6 : 2.4) + '" fill="var(--tier-' + tierName[n.tier] + ')"/>';
    });
    /* cursor */
    s += '<g><path d="M' + cx + ' ' + (cy - 252) + ' L' + cx + ' ' + (cy - 100) + '" stroke="var(--hot)" stroke-width="1.4" stroke-dasharray="2 4" opacity=".75"/><path d="M' + (cx - 8) + ' ' + (cy - 258) + ' L' + (cx + 8) + ' ' + (cy - 258) + ' L' + cx + ' ' + (cy - 244) + ' Z" fill="var(--hot)"/></g>';
    s += '<text class="t2" x="' + cx + '" y="' + (cy - 26) + '" text-anchor="middle">Next payout in</text><text class="t1" id="wheel-eta" x="' + cx + '" y="' + (cy + 6) + '" text-anchor="middle">18 s</text><text class="t2" x="' + cx + '" y="' + (cy + 28) + '" text-anchor="middle">block 2,996,930</text>';
    s += '</svg>';
    var rows = rings.map(function (rg) {
      var cyc = D.network.cycleHours[tierName[rg.t]], rew = D.network.reward[tierName[rg.t]];
      return '<div class="tierrow" data-tier="' + tierName[rg.t] + '">' + window.atlasTier(tierName[rg.t], 18) + '<div><div class="tn">' + tierLabel[rg.t] + '</div><small>' + f0(rg.total) + ' nodes</small></div><div class="tr">' + f2(rew) + ' FLUX<br><span class="dim">cycle ' + cyc + ' h</span></div></div>';
    }).join('');
    var mine = D.operator.nodes.slice(0, 5).map(function (n) {
      var eta = n.rank * 30;
      var txt = eta < 90 ? 'next block' : (eta < 3600 ? Math.round(eta / 60) + ' min' : (eta / 3600).toFixed(1) + ' h');
      return '<div class="nrow" data-tier="' + tierName[n.tier] + '"><span style="color:var(--tier)">' + window.atlasTier(tierName[n.tier], 14) + '</span><span class="mono">:' + n.port + '</span><span class="rk">#' + f0(n.rank + 1) + '</span><span class="eta">' + txt + '</span></div>';
    }).join('');
    var body = '<div class="wheelwrap"><div class="wl">' + s + '</div><div class="wr">' + rows +
      '<div class="cap" style="margin-top:4px">Rings run from the outside in: Cumulus, Nimbus, Stratus. Each ring is one tier, ordered by queue position. The cursor is the next payee, and every block the wheel advances one slot. New nodes join at the back.</div>' +
      '<div style="margin-top:6px"><div class="cap" style="font-weight:500;color:var(--text-2);margin-bottom:4px">Your nodes <span class="mono">t1cz5P…Dg9</span></div>' + mine + '</div></div></div>';
    return V.chrome({ id: 'win-queue', x: x, y: y, w: w, h: h, accent: 'pulse', focus: true, title: 'Payment queue', sub: 'One node per tier is paid every block', glyph: I('coins', { size: 16 }), body: body, fresh: 'tip', freshText: 'now' });
  };

  /* ---------- operator ---------- */
  V.operator = function (x, y, w, h) {
    var ops = D.operator.nodes;
    var rows = ops.map(function (n) {
      var eta = n.rank * 30, txt = eta < 90 ? 'next block' : (eta < 3600 ? Math.round(eta / 60) + ' min' : (eta / 3600).toFixed(1) + ' h');
      return '<div class="nrow" data-tier="' + tierName[n.tier] + '"><span style="color:var(--tier)">' + window.atlasTier(tierName[n.tier], 14) + '</span><span class="mono">65.109.26.93:' + n.port + '</span><span class="rk">#' + f0(n.rank + 1) + '</span><span class="eta">' + txt + '</span></div>';
    }).join('');
    var body =
      '<div class="sec"><div class="row wrap" style="margin-bottom:10px"><span class="chip chip--accent">' + I('user-round-check', { size: 13 }) + 'Operator</span><span class="chip chip--mono">' + mid(D.operator.addr, 9, 6) + '</span><button class="btn btn--sm btn--ghost" style="margin-left:auto">' + I('bell-ring', { size: 14 }) + 'Alerts on</button></div>' +
        '<div class="grid2"><div class="tile"><div class="k">Nodes</div><div class="v">7<small>1 host</small></div><div class="d">6 Stratus &middot; 1 Cumulus</div></div><div class="tile"><div class="k">Earning per day</div><div class="v">89.1<small>FLUX</small></div><div class="d up">about $6.65</div></div>' +
        '<div class="tile"><div class="k">Next payout</div><div class="v" id="op-next">18 s</div><div class="d">Stratus :16147, 9.00 FLUX</div></div><div class="tile"><div class="k">Collateral locked</div><div class="v">241.0K<small>FLUX</small></div><div class="d">6 x 40,000 + 1,000</div></div></div></div>' +
      '<div class="sec"><div class="alert"><span class="ai">' + I('triangle-alert', { size: 16 }) + '</span><div><b>Concentration risk</b>All 7 nodes share one IP in one datacenter. A single outage would stop 100% of your payouts. Spreading across two hosts would halve the exposure.</div></div></div>' +
      '<div class="sec"><h3>Queue<span class="aside">sorted by next payout</span></h3>' + rows + '</div>' +
      '<div class="sec"><h3>Watchlist</h3><div class="row wrap"><span class="chip chip--mono">' + mid('80.72.20.160:16137', 9, 6) + '</span><span class="chip chip--mono">94.130.137.2:16127</span><button class="btn btn--sm btn--ghost">' + I('eye', { size: 14 }) + 'Add</button></div>' +
        '<p class="cap" style="margin:10px 0 0">Stored in this browser only. Nothing is uploaded, and no account is needed.</p></div>';
    return V.chrome({ id: 'win-operator', x: x, y: y, w: w, h: h, accent: 'operator', focus: true, title: 'Your nodes', sub: 'Operator &middot; 7 nodes', glyph: I('user-round-check', { size: 16 }), body: body, fresh: 'nodes', freshText: '4 s' });
  };

  /* ---------- analytics ---------- */
  V.analytics = function (x, y, w, h) {
    var N = D.network;
    /* nodes over time, stacked area (illustrative 30 day series) */
    var days = 30, cu = [], ni = [], st = [];
    for (var i = 0; i < days; i++) { var k = i / (days - 1), e = Math.pow(k, 1.4); cu.push(3150 + 228 * e + 22 * Math.sin(i * 0.9) + (i === 17 ? -60 : 0)); ni.push(1520 + 62 * e + 9 * Math.sin(i * 1.3)); st.push(1655 + 109 * e + 11 * Math.sin(i * 0.7)); }
    var area = (function () {
      var W = 420, H = 172, pl = 34, pb = 20, iw = W - pl - 8, ih = H - pb - 8, mx = 7200, mn = 0;
      var X = function (i) { return pl + i / (days - 1) * iw; }, Y = function (v) { return 8 + ih - (v - mn) / (mx - mn) * ih; };
      var layers = [{ v: st, c: 'var(--tier-stratus-ink)', n: 'Stratus' }, { v: ni, c: 'var(--tier-nimbus-ink)', n: 'Nimbus' }, { v: cu, c: 'var(--tier-cumulus-ink)', n: 'Cumulus' }];
      var acc = new Array(days).fill(0), s = '<defs>';
      layers.forEach(function (L, q) { s += '<linearGradient id="ar' + q + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + L.c + '" stop-opacity=".9"/><stop offset="1" stop-color="' + L.c + '" stop-opacity=".42"/></linearGradient>'; });
      s += '</defs>';
      [0, 2000, 4000, 6000].forEach(function (g) { s += '<line x1="' + pl + '" x2="' + (W - 8) + '" y1="' + Y(g) + '" y2="' + Y(g) + '" stroke="var(--viz-grid)" stroke-dasharray="' + (g ? '2 4' : '0') + '"/><text x="' + (pl - 7) + '" y="' + (Y(g) + 3) + '" text-anchor="end">' + (g / 1000) + 'k</text>'; });
      layers.forEach(function (L, q) {
        var top = L.v.map(function (v, i) { return acc[i] + v; }), d = '', dl = '';
        for (var a = 0; a < days; a++) { d += (a ? ' L' : 'M') + X(a).toFixed(1) + ' ' + Y(top[a]).toFixed(1); }
        dl = d;
        for (var b = days - 1; b >= 0; b--) d += ' L' + X(b).toFixed(1) + ' ' + Y(acc[b]).toFixed(1);
        s += '<path d="' + d + ' Z" fill="url(#ar' + q + ')" stroke="var(--ink-1)" stroke-width="2" paint-order="stroke"/>';
        s += '<path d="' + dl + '" fill="none" stroke="' + L.c + '" stroke-width="1.6" stroke-linejoin="round" style="filter:brightness(1.25)"/>';
        acc = top;
      });
      s += '<text x="' + pl + '" y="' + (H - 3) + '">Sep 1</text><text x="' + (W - 8) + '" y="' + (H - 3) + '" text-anchor="end">Sep 30</text>';
      s += '<line x1="' + X(days - 1) + '" x2="' + X(days - 1) + '" y1="8" y2="' + (8 + ih) + '" stroke="var(--hot)" stroke-opacity=".5"/><circle cx="' + X(days - 1) + '" cy="' + Y(acc[days - 1]) + '" r="3.5" fill="var(--hot)" stroke="var(--ink-1)" stroke-width="2"/>';
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Nodes per tier over 30 days, stacked">' + s + '</svg>';
    })();
    /* version wave */
    var wave = (function () {
      var W = 420, H = 150, pl = 34, pb = 18, iw = W - pl - 6, ih = H - pb - 6, s = '';
      var X = function (i) { return pl + i / 119 * iw; }, Y = function (v) { return 6 + ih - v * ih; };
      [0, 0.5, 1].forEach(function (g) { s += '<line x1="' + pl + '" x2="' + (W - 6) + '" y1="' + Y(g) + '" y2="' + Y(g) + '" stroke="var(--viz-grid)"/><text x="' + (pl - 6) + '" y="' + (Y(g) + 3) + '" text-anchor="end">' + (g * 100) + '%</text>'; });
      var up = [], old = [];
      for (var i = 0; i < 120; i++) { var t = i / 119; var v = 1 / (1 + Math.exp(-(t - 0.32) * 18)); up.push(v * 0.999); old.push(Math.max(0, 1 - v) * 0.92); }
      var path = function (arr) { return arr.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' '); };
      s += '<path d="' + path(old) + '" fill="none" stroke="var(--text-4)" stroke-width="2" stroke-linecap="round"/>';
      s += '<path d="' + path(up) + ' L' + X(119) + ' ' + Y(0) + ' L' + X(0) + ' ' + Y(0) + ' Z" fill="var(--seq-4)" opacity=".12"/><path d="' + path(up) + '" fill="none" stroke="var(--seq-5)" stroke-width="2" stroke-linecap="round"/>';
      s += '<circle cx="' + X(119) + '" cy="' + Y(0.999) + '" r="4" fill="var(--seq-5)" stroke="var(--ink-1)" stroke-width="2"/>';
      s += '<text x="' + (X(119) - 8) + '" y="' + (Y(0.999) + 16) + '" text-anchor="end" style="fill:var(--text-2)">8.20.0 99.9%</text>';
      s += '<text x="' + pl + '" y="' + (H - 2) + '">Sep 25, release</text><text x="' + (W - 6) + '" y="' + (H - 2) + '" text-anchor="end">Sep 30</text>';
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Adoption of FluxOS 8.20.0 since release: 99.9 percent">' + s + '</svg>';
    })();
    /* churn diverging */
    var churn = (function () {
      var W = 420, H = 110, n = 14, bw = 14, gap = (W - 40 - n * bw) / (n - 1), s = '', mid2 = 54;
      var joins = [18, 22, 14, 31, 17, 12, 26, 19, 23, 16, 28, 21, 15, 24], leaves = [14, 19, 21, 12, 25, 9, 20, 22, 11, 27, 13, 18, 23, 17];
      s += '<line x1="30" x2="' + (W - 6) + '" y1="' + mid2 + '" y2="' + mid2 + '" stroke="var(--viz-axis)"/>';
      for (var i = 0; i < n; i++) { var x = 34 + i * (bw + gap); s += '<rect x="' + x + '" y="' + (mid2 - joins[i] * 1.5) + '" width="' + bw + '" height="' + (joins[i] * 1.5 - 1) + '" rx="3" fill="var(--div-pos)"/><rect x="' + x + '" y="' + (mid2 + 1) + '" width="' + bw + '" height="' + (leaves[i] * 1.5 - 1) + '" rx="3" fill="var(--div-neg)"/>'; }
      s += '<text x="0" y="' + (mid2 - 30) + '">+joins</text><text x="0" y="' + (mid2 + 36) + '">-leaves</text>';
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Daily joins and leaves for 14 days">' + s + '</svg>';
    })();
    var orgs = [['Hetzner', 24, 'var(--viz-1)'], ['GHOSTnet', 7.4, 'var(--viz-1)'], ['Stofa', 6.3, 'var(--viz-1)'], ['OVH', 5.1, 'var(--viz-1)'], ['Free SAS', 2.8, 'var(--viz-1)']];
    var capacity = [['CPU', '54,451 cores', 27], ['Memory', '182 TB', 16], ['SSD', '3.19 PB', 12]];
    var blocksLeft = D.emission.cutHeight - D.clock.tip;
    var body = '<div class="dash">' +
      '<div class="card c12 cutcard"><div class="cutrow"><div><h4>Reward cut<span class="aside">block 3,071,200</span></h4><div class="sub">The first 10% subsidy reduction.</div><div class="big" id="cut-blocks">' + f0(blocksLeft) + '<span style="font-size:14px;font-weight:400;color:var(--text-3);margin-left:8px">blocks</span></div><div class="row" style="margin-top:4px"><span class="mono">about <b style="color:var(--hot);font-weight:500">25d 18h</b></span><span class="dim">around 2026-10-26</span></div></div>' +
        '<div class="cutmid"><div class="cutbar" title="Progress from the start of Proof of Node to the first reward cut"><i style="width:92.9%"></i><b style="left:92.9%"></b></div><div class="row" style="justify-content:space-between;margin:8px 0 0;font:500 10.5px/1 var(--font-mono);color:var(--text-4)"><span>PoN starts 2,020,000</span><span>92.9%</span><span>cut 3,071,200</span></div></div>' +
        '<div class="grid3 cuttiles"><div class="tile"><div class="k">Cumulus</div><div class="v" style="font-size:18px">1.0<small>to 0.9</small></div></div><div class="tile"><div class="k">Nimbus</div><div class="v" style="font-size:18px">3.5<small>to 3.15</small></div></div><div class="tile"><div class="k">Stratus</div><div class="v" style="font-size:18px">9.0<small>to 8.1</small></div></div></div></div></div>' +
      '<div class="card c7"><h4>Nodes by tier<span class="aside">30 days, illustrative series</span></h4><div class="sub">6,724 confirmed nodes on 2,655 hosts, 64% behind UPnP.</div><div class="chart">' + area + '</div><div class="legend"><span style="--c:var(--tier-cumulus-ink)"><i></i>Cumulus 3,378</span><span style="--c:var(--tier-nimbus-ink)"><i></i>Nimbus 1,582</span><span style="--c:var(--tier-stratus-ink)"><i></i>Stratus 1,764</span></div></div>' +
      '<div class="card c5"><h4>Decentralization<span class="aside">Nakamoto coefficient</span></h4><div class="sub">Entities needed to reach 51% of nodes.</div><div class="nak"><div class="n"><b>9</b><small>by organization</small><div class="lv"><i style="width:45%"></i></div></div><div class="n"><b>10</b><small>by ASN</small><div class="lv"><i style="width:50%"></i></div></div><div class="n"><b>3</b><small>by country</small><div class="lv"><i style="width:15%"></i></div></div></div>' +
        '<div class="bars" style="margin-top:14px">' + orgs.map(function (o) { return '<div class="b"><span>' + o[0] + '</span><div class="tr"><i style="width:' + (o[1] / 24 * 100) + '%;background:' + o[2] + '"></i></div><em>' + o[1] + '%</em></div>'; }).join('') + '</div></div>' +
      '<div class="card c7"><h4>Capacity and what apps lock<span class="aside">benchmarked</span></h4><div class="sub">Locked by running apps, today.</div><div class="bars">' + capacity.map(function (c) { return '<div class="b" style="grid-template-columns:70px 1fr 130px"><span>' + c[0] + '</span><div class="tr"><i style="width:' + c[2] + '%;background:linear-gradient(90deg,var(--viz-1),var(--accent-300))"></i></div><em style="text-align:left;white-space:nowrap">' + c[2] + '% of ' + c[1] + '</em></div>'; }).join('') + '</div>' +
        '<div class="grid3" style="margin-top:14px"><div class="tile"><div class="k">Apps</div><div class="v">1,882</div><div class="d">1,779 running</div></div><div class="tile"><div class="k">Instances</div><div class="v">8,274</div><div class="d">across 54 countries</div></div><div class="tile"><div class="k">ArcaneOS</div><div class="v">94%</div><div class="d">6,182 of 6,571</div></div></div></div>' +
      '<div class="card c5"><h4>FluxOS 8.20.0 adoption<span class="aside">since Sep 25</span></h4><div class="sub">97.6% within 5 days of release.</div><div class="chart">' + wave + '</div></div>' +
      '<div class="card c12"><h4>Churn<span class="aside">14 days</span></h4><div class="sub">Nodes joined and expired each day, with the net change.</div><div class="chart">' + churn + '</div><div class="legend"><span style="--c:var(--div-pos)"><i></i>Joined, +23 a day</span><span style="--c:var(--div-neg)"><i></i>Left, -19 a day</span></div></div></div>';
    return V.chrome({ id: 'win-analytics', x: x, y: y, w: w, h: h, accent: 'analytics', focus: true, title: 'Network analytics', sub: 'Counts, concentration, capacity, versions, churn', glyph: I('chart-no-axes-combined', { size: 16 }), tabs: ['Overview', 'Geography', 'Hosting', 'Capacity', 'Versions', 'Churn', 'Archaeology'], body: body, fresh: 'stats', freshText: '7 min' });
  };

  /* ---------- terminal ---------- */
  V.terminal = function (x, y, w, h) {
    var prompt = '<span class="ps"><span class="a">atlas@flux</span><span class="b">~</span></span> ';
    var body = '<div class="term">' +
      '<div class="ln dim">Atlas shell 2.0. Type help, or press Tab to complete.</div>' +
      '<div class="ln">' + prompt + 'next</div>' +
      '<div class="ln"><span class="hot">Block 2,996,930</span> in <span class="hot">18 s</span>   tip 2,996,929 <span class="dim">(12 s ago)</span></div>' +
      '<div class="ln">  <span style="color:var(--tier-stratus)">Stratus </span>  9.00  <span class="acc">65.109.26.93:16147</span>  Helsinki</div>' +
      '<div class="ln">  <span style="color:var(--tier-nimbus)">Nimbus  </span>  3.50  <span class="acc">38.247.82.140:16147</span>  Raleigh</div>' +
      '<div class="ln">  <span style="color:var(--tier-cumulus)">Cumulus </span>  1.00  <span class="acc">80.72.20.160:16137</span>  Taganrog</div>' +
      '<div class="ln">' + prompt + 'node 65.109.26.93</div>' +
      '<div class="ln">7 nodes on host 65.109.26.93 <span class="dim">(Helsinki, Hetzner), one operator</span></div>' +
      '<div class="ln">  :16147 <span style="color:var(--tier-stratus)">Stratus</span>  #1    next block      <span class="ok">confirmed</span></div>' +
      '<div class="ln">  :16167 <span style="color:var(--tier-stratus)">Stratus</span>  #1,122 about 9.3 h     <span class="ok">confirmed</span></div>' +
      '<div class="ln">' + prompt + 'goto helsinki <span class="cur"></span></div>' +
      '<div class="tryrow">try <button>help</button><button>block tip</button><button>app BitcoinWhitepaper</button><button>operator t1cz5P</button><button>moon</button><button>ambient</button></div></div>';
    return V.chrome({ id: 'win-term', x: x, y: y, w: w, h: h, accent: 'terminal', focus: true, title: 'Terminal', sub: 'atlas@flux', glyph: I('square-terminal', { size: 16 }), body: body, fresh: 'tip', freshText: 'live' });
  };

  /* ---------- About Flux: opened from the moon ---------- */
  V.about = function (x, y, w, h) {
    var N = D.network, FB = window.FluxBrand, tn = ['Cumulus', 'Nimbus', 'Stratus'];
    var cutIn = D.emission.cutHeight - D.clock.tip, cutDays = Math.floor(cutIn * 30 / 86400), cutH = Math.floor((cutIn * 30 % 86400) / 3600);
    var tonal = { cap: '#ffffff', big: '#cccccc', small: '#7e7c7c', spark: '#ffffff' };
    function only(id, size) { var f = { cap: '#2d2d2d', big: '#2d2d2d', small: '#2d2d2d', spark: '#2d2d2d' }; f[id] = tonal[id]; return FB.mark({ size: size, fill: f }); }
    var rows = [
      { id: 'cap', t: 2, name: 'Cap', who: 'Stratus', pay: 9.0, cyc: '14.7 h' },
      { id: 'big', t: 1, name: 'Big hexagon', who: 'Nimbus', pay: 3.5, cyc: '13.2 h' },
      { id: 'small', t: 0, name: 'Small hexagon', who: 'Cumulus', pay: 1.0, cyc: '28 h' },
      { id: 'spark', t: -1, name: 'Bar', who: 'Dev fund', pay: 0.5, cyc: 'every block' }
    ].map(function (r) {
      return '<div class="ab-leg"' + (r.t >= 0 ? ' data-tier="' + tierName[r.t] + '"' : '') + '><span class="pc">' + only(r.id, 30) + '</span><span class="lb"><b>' + r.who + '</b><small>' + r.name + (r.t >= 0 ? ' &middot; ' + r.cyc + ' cycle' : ' &middot; ' + r.cyc) + '</small></span>' +
        (r.t >= 0 ? '<span class="tm" style="color:var(--tier)">' + window.atlasTier(tierName[r.t], 13) + '</span>' : '<span class="tm"></span>') + '<span class="am mono">' + f2(r.pay) + ' FLUX</span></div>';
    }).join('');
    var bars = [0, 1, 2].map(function (t) { var n = N.tiers[tierName[t]]; return '<div class="ab-bar" data-tier="' + tierName[t] + '"><span class="nm">' + window.atlasTier(tierName[t], 13) + tn[t] + '</span><span class="tr"><i style="width:' + (n / N.nodes * 100).toFixed(1) + '%"></i></span><span class="mono">' + f0(n) + '</span></div>'; }).join('');
    var body =
      '<div class="ab-hero"><div class="ab-pat" aria-hidden="true"></div><div class="ab-logo" data-brand="logo" data-s="70" data-variant="onblue" data-word="atlas" data-title="Flux Atlas"></div>' +
        '<p class="ab-kick">The live Flux network, as a place you can open.</p></div>' +
      '<div class="sec"><h3>The chain, right now<span class="aside">updates every block</span></h3>' +
        '<div class="ab-chain"><div class="ab-ring"><svg viewBox="0 0 60 60" width="60" height="60" aria-hidden="true"><circle cx="30" cy="30" r="25" class="trk"/><circle cx="30" cy="30" r="25" class="prg"/></svg><b id="ab-cd">18</b><small>s</small></div>' +
        '<div class="ab-tip"><div class="k">Block tip</div><div class="v" id="ab-tip">2,996,929</div><div class="d">Block 2,996,930 lands in <span class="mono" id="ab-cd2">18</span> s. One block every 30 seconds.</div></div></div>' +
        '<div class="grid3" style="margin-top:12px"><div class="tile"><div class="k">Nodes</div><div class="v">' + f0(N.nodes) + '</div><div class="d">' + f0(N.hosts) + ' IP addresses</div></div><div class="tile"><div class="k">Apps</div><div class="v">' + f0(N.apps) + '</div><div class="d">' + f0(N.instances) + ' instances</div></div><div class="tile"><div class="k">Reach</div><div class="v">' + N.countries + '<small>countries</small></div><div class="d">' + N.asns + ' networks</div></div></div>' +
        '<div class="ab-bars">' + bars + '</div></div>' +
      '<div class="sec"><h3>The moon is the chain<span class="aside">how a block pays out</span></h3>' +
        '<div class="ab-anat"><div class="sym">' + FB.mark({ size: 112, fill: tonal, title: 'The Flux symbol, as the moon' }) + '</div><div class="legs">' + rows + '</div></div>' +
        '<p class="cap" style="margin-top:10px">A producer node finds the block and sends it up to the moon. The moon sets aside 0.5 FLUX for the development fund, then pays a Cumulus, a Nimbus and a Stratus node, small to large, in the order the chain lists them.</p></div>' +
      '<div class="sec"><h3>Capacity<span class="aside">across every node</span></h3><dl class="kv">' +
        '<dt>CPU cores</dt><dd>' + f0(N.cores) + '</dd><dt>Memory</dt><dd>' + N.ramTB + ' TB</dd><dt>SSD</dt><dd>' + N.ssdPB + ' PB</dd><dt>Locked by apps</dt><dd>' + N.lockedCpuPct + '% CPU &middot; ' + N.lockedRamPct + '% RAM</dd><dt>Running ArcaneOS</dt><dd>' + N.arcanePct + '%</dd><dt>FluxOS</dt><dd>' + N.fluxos + '</dd></dl></div>' +
      '<div class="sec"><h3>Next reward cut<span class="aside">block ' + f0(D.emission.cutHeight) + '</span></h3><div class="tile" style="gap:6px"><div class="v"><span id="ab-cut">' + f0(cutIn) + '</span><small>blocks</small></div><div class="d">about ' + cutDays + ' days ' + cutH + ' hours from now</div></div></div>' +
      '<div class="sec ab-quote"><blockquote>To build a scalable, decentralized network of computing power for the people, by the people.</blockquote><cite>The Flux mission</cite></div>' +
      '<div class="sec ab-foot"><div class="row wrap"><a class="chip" href="#">runonflux.io</a><a class="chip" href="#">Documentation</a><a class="chip" href="#">Explorer API</a></div>' +
        '<p class="cap">Flux Atlas 2.0 preview &middot; data from the Flux network, open to everyone. Flux and the Flux symbol are trademarks of their owners. Flux Atlas is an ecosystem tool for the Flux network.</p></div>';
    return V.chrome({ id: 'win-about', x: x, y: y, w: w, h: h, accent: 'chain', focus: true, title: 'About Flux', sub: 'Atlas 2.0 &middot; live network totals', glyph: FB.mark({ size: 15, fill: '#ffffff' }), body: body, fresh: 'tip', freshText: 'live' });
  };

  /* ---------- palette data ---------- */
  V.paletteRows = function (q) {
    var R = [
      { g: 'Nodes', rows: [
        { ic: 'stratus', k: 'var(--tier-stratus)', t: '<mark>65.109</mark>.26.93:16147', m: true, s: 'Stratus, Helsinki, next in line', meta: '<span class="chip chip--status" data-status="ok" style="height:20px"><i class="dot"></i>Confirmed</span>' },
        { ic: 'stratus', k: 'var(--tier-stratus)', t: '<mark>65.109</mark>.26.93:16127', m: true, s: 'Stratus, Helsinki, queue #1,700', meta: '' },
        { ic: 'nimbus', k: 'var(--tier-nimbus)', t: '<mark>65.109</mark>.63.147:16147', m: true, s: 'Nimbus, Helsinki, produced block 2,996,914', meta: '' },
        { ic: 'cumulus', k: 'var(--tier-cumulus)', t: '<mark>65.109</mark>.121.73:16127', m: true, s: 'Cumulus, Helsinki', meta: '' }] },
      { g: 'Hosts and providers', rows: [
        { ic: 'server', k: 'var(--accent-400)', t: 'Host <mark>65.109</mark>.26.93', m: false, s: '7 nodes, 1 operator', meta: '<span class="dim">Hetzner</span>' },
        { ic: 'network', k: 'var(--viz-2)', t: 'Hetzner Online GmbH', m: false, s: 'AS24940 &middot; 1,614 nodes, 24% of the network', meta: '' }] },
      { g: 'Go to', rows: [
        { ic: 'locate-fixed', k: 'var(--hot)', t: 'Fly to Helsinki', m: false, s: '491 nodes at this site', meta: '<span class="kbd">G</span><span class="kbd">H</span>' },
        { ic: 'user-round-check', k: 'var(--accent-operator)', t: 'Open operator t1cz5P…Dg9', m: false, s: 'Owner of 7 nodes, payment address', meta: '' },
        { ic: 'fluxmark', k: 'var(--accent-400)', t: 'About Flux', m: false, s: 'The moon, live network totals', meta: '<span class="kbd">M</span>' }] }
    ];
    return R;
  };
})();
