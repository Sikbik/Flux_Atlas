/* Flux Atlas design mock: shell behaviours. Live-first: a real 30 s Beat, a block landing choreography,
   a live pulse feed with freshness counters, hover-freeze, palette, dock with aperture open, ambient, time machine.
   Query: ?view=node|palette|landing|tx|app|queue|analytics|operator|time|ambient|weather|terminal  &freeze=1  &speed=3 */
(function () {
  'use strict';
  var D = window.ATLAS_DATA, V = window.ATLAS_VIEWS, I = window.atlasIcon;
  var qs = new URLSearchParams(location.search);
  var view = qs.get('view') || 'node', freeze = qs.get('freeze') === '1', speed = parseFloat(qs.get('speed') || '1');
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var f0 = V.f0, f2 = V.f2, mid = V.mid;
  var tierName = ['cumulus', 'nimbus', 'stratus'], tierLabel = ['Cumulus', 'Nimbus', 'Stratus'];
  var W = window.innerWidth, H = window.innerHeight;
  var root = document.documentElement, body = document.body;

  /* ---------- state ---------- */
  var S = { tip: D.clock.tip, tipTime: D.clock.tipTime, base: D.clock.demoNow, t0: performance.now(), nextAt: D.clock.tipTime + 30, landed: 0, blocks: D.blocks.slice().reverse(), feed: D.feed.slice(), view: view, heroPaid: false, frozen: freeze };
  S.now = function () { return S.frozen ? S.base + (S.frozenAt || 0) : S.base + (performance.now() - S.t0) / 1000 * speed; };
  var fmtClock = function (t) { var d = new Date(t * 1000); return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2) + ':' + ('0' + d.getUTCSeconds()).slice(-2); };
  var ageText = function (s) { s = Math.max(0, Math.floor(s)); return s < 4 ? 'now' : (s < 60 ? s + ' s' : (s < 3600 ? Math.floor(s / 60) + ' min' : Math.floor(s / 3600) + ' h')); };

  /* ---------- globe ---------- */
  var globe = new window.AtlasGlobe($('#globe'), D, { dprCap: 2 });
  window.atlasGlobe = globe;
  var hero = D.hero.idx, curNode = hero;
  var geo = function (idx) { return { lat: D.nodes.lat[idx], lon: D.nodes.lon[idx] }; };

  /* ---------- layout ---------- */
  var TOP = 52, BOT = 28 + 126, DOCK = 80, GAP = 12, TAB = W < 1280, INSP = TAB ? 372 : 420;
  var dockedRect = function (w) { return { x: W - w - GAP, y: TOP + GAP, w: w, h: H - TOP - BOT - GAP * 2 - 4 }; };
  var CFG = {
    node:     { wins: [function () { var r = dockedRect(INSP); return V.node(r.x, r.y, r.w, r.h, curNode); }], inset: { left: DOCK, right: INSP + 24, top: 40, bottom: 128 }, pose: { lat: 42, lon: -22, size: 100, roll: -14 }, sel: true, open: ['node'], focus: 'node' },
    tx:       { wins: [function () { return V.tx(118, 68, Math.min(820, W - 118 - 16), H - TOP - BOT - 12); }], inset: { left: 940, right: 0, top: 40, bottom: 128 }, pose: { lat: 40, lon: 8, size: 92, roll: -14 }, sel: false, open: ['tx'], focus: 'tx', aim: true },
    app:      { wins: [function () { var r = dockedRect(TAB ? 380 : 452); return V.app(r.x, r.y, r.w, r.h); }], inset: { left: DOCK, right: (TAB ? 380 : 452) + 24, top: 40, bottom: 128 }, pose: { lat: 50, lon: 6, size: 200, roll: -8 }, sel: false, open: ['app'], focus: 'app', constellation: true },
    queue:    { wins: [function () { return V.queue(112, 64, Math.min(820, W - 112 - 16), H - TOP - BOT - 12); }], inset: { left: 940, right: 0, top: 40, bottom: 128 }, pose: { lat: 40, lon: 8, size: 92, roll: -14 }, sel: false, open: ['queue'], focus: 'queue', aim: true },
    analytics:{ wins: [function () { return V.analytics(96, 62, Math.min(1112, W - 96 - 16), H - TOP - BOT - 10); }], inset: { left: Math.min(1224, W - 380), right: 0, top: 40, bottom: 128 }, pose: { lat: 38, lon: 6, size: 100, roll: -14 }, sel: false, open: ['analytics'], focus: 'analytics' },
    operator: { wins: [function () { var r = dockedRect(TAB ? 380 : 440); return V.operator(r.x, r.y, r.w, r.h); }], inset: { left: DOCK, right: (TAB ? 380 : 440) + 24, top: 40, bottom: 128 }, pose: { lat: 60.2, lon: 24.9, size: 900, roll: 0 }, sel: false, open: ['operator'], focus: 'operator', aim: false, fleet: true },
    terminal: { wins: [function () { return V.terminal(96, 300, 760, 420); }], inset: { left: DOCK, right: 0, top: 40, bottom: 128 }, pose: { lat: 41, lon: 7, size: 100, roll: -14 }, sel: true, open: ['terminal'], focus: 'terminal', aim: true },
    time:     { wins: [], inset: { left: DOCK, right: 0, top: 40, bottom: 28 + 22 + 104 + 54 }, pose: { lat: 41, lon: 7, size: 100, roll: -14 }, sel: false, open: [], focus: 'time', mode: 'archive' },
    weather:  { wins: [], inset: { left: DOCK, right: 0, top: 40, bottom: 128 }, pose: { lat: 40, lon: 22, size: 104, roll: -10 }, sel: false, open: [], focus: 'weather', weather: true },
    ambient:  { wins: [], inset: { left: 0, right: 0, top: 0, bottom: 0 }, pose: { lat: 28, lon: -8, size: 96, roll: -16 }, sel: false, open: [], focus: 'ambient', mode: 'ambient' }
  };
  CFG.about = { wins: [function () { var r = dockedRect(TAB ? 400 : 464); return V.about(r.x, r.y, r.w, r.h); }], inset: { left: DOCK, right: (TAB ? 400 : 464) + 24, top: 40, bottom: 128 }, pose: { lat: 42, lon: -22, size: 100, roll: -14 }, sel: false, open: ['about'], focus: 'about', aim: true };
  CFG.bare = { wins: [], inset: { left: DOCK, right: 0, top: 40, bottom: 128 }, pose: { lat: 42, lon: -22, size: 100, roll: -14 }, sel: false, open: [], focus: 'globe' };
  CFG.palette = Object.assign({}, CFG.node, { palette: true });
  CFG.landing = Object.assign({}, CFG.node, { landing: true });

  function aimPayees() {
    var L = D.landing;
    return [
      { node: L.payees[0].node, tier: 0, amount: 1.0, label: 'Taganrog', dx: 24, dy: 14 },
      { node: L.payees[1].node, tier: 1, amount: 3.5, label: 'Raleigh', dx: -108, dy: 26 },
      { node: L.payees[2].node, tier: 2, amount: 9.0, label: 'Helsinki', dx: 26, dy: -26 }
    ];
  }

  function applyView(name, from) {
    var c = CFG[name] || CFG.node; S.view = name; body.dataset.view = name;
    var host = $('#windows'); host.innerHTML = '';
    c.wins.forEach(function (fn) { host.insertAdjacentHTML('beforeend', fn()); });
    window.atlasHydrate(host);
    /* aperture: open the window out of its source */
    var w = $('.win-wrap', host);
    S.tetherT0 = from || name === 'node' ? performance.now() : 0;
    if (w && from) {
      var br = w.getBoundingClientRect(), ox = from.x - br.left, oy = from.y - br.top;
      w.style.setProperty('--ox', ox + 'px'); w.style.setProperty('--oy', oy + 'px'); w.classList.add('is-opening');
      setTimeout(function () { w.classList.remove('is-opening'); }, 760);
    }
    body.dataset.mode = c.mode || 'live'; body.dataset.tl = name === 'time' ? 'open' : '';
    globe.setMode(c.mode || 'live');
    globe.setInset(c.inset, from ? 420 : 0);
    if (!from) globe.setPose(c.pose); else globe.flyTo({ lat: c.pose.lat, lon: c.pose.lon, size: c.pose.size }, 1100);
    globe.pose.roll = c.pose.roll;
    globe.setLayers({ weather: !!c.weather, towers: !c.constellation, mesh: (c.sel ? 'selection' : (name === 'ambient' ? 'flow' : 'off')), aim: !!c.aim || name === 'node' || name === 'palette' || name === 'landing', labels: name !== 'ambient' && !c.fleet && !c.constellation });
    if (c.sel) { globe.select(curNode); } else { globe.select(-1); }
    globe.setConstellation(c.constellation ? D.appNodes.map(function (o) { return o.idx; }) : null);
    if (c.fleet) globe.setConstellation(D.heroHost.map(function (o) { return o.idx; }), 'mine');
    globe.setAim(aimPayees(), Math.max(0, S.nextAt - S.now()) * 1000);
    /* dock state */
    $$('.dock .dk').forEach(function (b) { var o = b.dataset.open; b.classList.toggle('is-open', c.open.indexOf(o) >= 0); b.classList.toggle('is-focus', o === c.focus || (name === 'palette' && o === 'node') || (name === 'landing' && o === 'node') || (!c.focus && o === 'globe')); });
    $('#aimstrip').hidden = name === 'time' || name === 'ambient' || name === 'weather' || name === 'analytics';
    layoutAim(c);
    if (name === 'app') drawConstMap();
    buildTimeline(name === 'time');
    if (name === 'weather') showWeatherChip(); else $('#wxchip') && $('#wxchip').remove();
    if (name === 'time') showArchiveChip(); else $('#archchip') && $('#archchip').remove();
    body.classList.toggle('has-win', c.wins.length > 0);
    tick(true); edgeAll(); setTimeout(edgeAll, 120);
  }
  function layoutAim(c) {
    var ins = c.inset, cx = ins.left + (W - ins.left - ins.right) / 2;
    $('#aimstrip').style.setProperty('--aim-x', cx + 'px');
  }

  /* ---------- rail ---------- */
  function blockCard(b, isNew) {
    var p = b.prod, t = p.tier, pct = [1, 3.5, 9, 0.5].map(function (v) { return v / 14 * 100; });
    return '<article class="blk' + (isNew ? ' is-new' : '') + '" data-tier="' + tierName[t] + '" data-h="' + b.h + '">' +
      '<div class="r1"><b>' + f0(b.h) + '</b><time data-ts="' + b.time + '">' + ageText(S.now() - b.time) + '</time></div>' +
      '<div class="r2">' + b.tx + ' tx &middot; ' + (b.size / 1000).toFixed(1) + ' KB</div>' +
      '<div class="r3"><span class="pr">' + I('producer', { size: 14 }) + '</span>' + p.ip + '<em>' + p.city + '</em></div>' +
      '<div class="strip" title="Reward split: 1.0 Cumulus, 3.5 Nimbus, 9.0 Stratus, 0.5 fund"><i style="width:' + pct[0] + '%;background:var(--tier-cumulus)"></i><i style="width:' + pct[1] + '%;background:var(--tier-nimbus)"></i><i style="width:' + pct[2] + '%;background:var(--tier-stratus)"></i><i style="width:' + pct[3] + '%;background:var(--text-4)"></i></div></article>';
  }
  function renderRail(newH) {
    var h = '';
    S.blocks.slice(-9).forEach(function (b) { h += blockCard(b, b.h === newH); });
    h += '<article class="blk ghost" id="ghost"><div class="r1"><b>' + f0(S.tip + 1) + '</b><span class="cdwn"><span id="g-cd">18</span> s</span></div>' +
      '<div class="r2">Next block &middot; <span id="g-mem">20 tx, 4.0 KB</span> waiting</div><div class="bar"><i></i></div></article>';
    $('#rail-track').innerHTML = h; window.atlasHydrate($('#rail-track'));
  }

  /* ---------- feed ---------- */
  var icoFor = { block: 'blocks', mine: 'eye', join: 'rocket', leave: 'triangle-alert', app: 'boxes', 'app-pending': 'hourglass', heartbeat: 'activity', version: 'badge-check' };
  function evtRow(e, fresh) {
    var tier = e.tier != null ? ' data-tier="' + tierName[e.tier] + '"' : '';
    var t = e.text.replace(/(\b\d[\d,.]*\d\b)/g, '<b>$1</b>');
    return '<li class="evt k-' + e.kind + (fresh ? ' is-fresh' : '') + '"' + tier + ' data-ts="' + (e.ts || (S.now() - e.age)) + '"><span class="ei">' + I(icoFor[e.kind] || 'activity', { size: 14 }) + '</span><div><span class="t">' + t + '</span><span class="sub">' + (e.meta || '') + '</span></div><time>' + ageText(e.age != null ? e.age : 0) + '</time></li>';
  }
  var feedFrozen = false, pendingEvents = [];
  function renderFeed(fresh) {
    var list = $('#pulse-list'), items = S.feed.slice(-6);
    list.innerHTML = items.map(function (e, i) { return evtRow(Object.assign({}, e, { ts: e.ts || (S.base - e.age) }), fresh && i === items.length - 1); }).join('');
    window.atlasHydrate(list);
  }
  function pushEvent(e) {
    e.ts = S.now(); e.age = 0;
    if (feedFrozen) { pendingEvents.push(e); showNewPill(); return; }
    S.feed.push(e); renderFeed(true);
  }
  function showNewPill() {
    var p = $('#newpill'); if (!p) { p = document.createElement('button'); p.id = 'newpill'; p.className = 'newpill'; p.onclick = flushFeed; $('#pulse').appendChild(p); }
    p.textContent = pendingEvents.length + ' new';
  }
  function flushFeed() { pendingEvents.forEach(function (e) { S.feed.push(e); }); pendingEvents = []; var p = $('#newpill'); if (p) p.remove(); renderFeed(true); }
  $('#pulse').addEventListener('mouseenter', function () { feedFrozen = true; });
  $('#pulse').addEventListener('mouseleave', function () { feedFrozen = false; setTimeout(function () { if (!feedFrozen) flushFeed(); }, 600); });

  /* ---------- toasts ---------- */
  function toast(o) {
    var t = document.createElement('div'); t.className = 'toast ' + (o.cls || '');
    t.style.setProperty('--tk', o.color || 'var(--accent-400)');
    t.innerHTML = '<span class="ti">' + I(o.icon || 'coins', { size: 18 }) + '</span><div><b>' + o.title + '</b><p>' + o.text + '</p></div><button class="x" aria-label="Dismiss">' + I('x', { size: 14 }) + '</button>';
    $('#toasts').appendChild(t); window.atlasHydrate(t);
    setTimeout(function () { t.style.transition = 'opacity 180ms, transform 180ms'; t.style.opacity = 0; t.style.transform = 'translateX(16px)'; setTimeout(function () { t.remove(); }, 200); }, o.ms || 6000);
    return t;
  }

  /* ---------- the Beat: a block lands ---------- */
  function randomLanding() {
    var n = D.nodes, pick = function (t) { for (var k = 0; k < 500; k++) { var x = Math.floor(D.rng() * n.n); if (n.tier[x] === t && !n.anchor[x] && (n.flags[x] & 8) === 0) return x; } return 0; };
    var prod = pick(Math.floor(D.rng() * 3));
    return { producer: prod, payees: [{ node: pick(0), tier: 0, amount: 1.0 }, { node: pick(1), tier: 1, amount: 3.5 }, { node: pick(2), tier: 2, amount: 9.0 }] };
  }
  function cityOf(idx) { return D.hubs[D.nodes.hub[idx]].name; }
  function landBlock(o) {
    o = o || {}; var L = S.landed === 0 ? { producer: D.landing.producer, payees: D.landing.payees } : randomLanding(), n = D.nodes;
    var t0 = o.t0 != null ? o.t0 : performance.now();
    S.landed++; S.tip++; S.tipTime = S.now(); S.nextAt = S.tipTime + 30;
    var txc = 8 + Math.floor(D.rng() * 12);
    var b = { h: S.tip, time: S.tipTime, size: 1800 + Math.floor(D.rng() * 1900), tx: txc, hash: '', prod: { ip: n.ip[L.producer], port: n.port[L.producer], tier: n.tier[L.producer], city: cityOf(L.producer) } };
    S.blocks.push(b); S.blocks = S.blocks.slice(-12);
    renderRail(b.h);
    globe.play({ kind: 'block', producer: L.producer, payees: L.payees }, t0);
    $('#tip').textContent = f0(S.tip); $('.beat-wrap').classList.remove('ping'); void $('.beat-wrap').offsetWidth; $('.beat-wrap').classList.add('ping');
    pushEvent({ kind: 'block', cls: 'p0', text: 'Block ' + f0(S.tip) + ' produced', meta: b.prod.ip + ':' + b.prod.port + ', ' + txc + ' tx, ' + (b.size / 1000).toFixed(1) + ' KB', tier: b.prod.tier });
    var heroPaid = L.payees.some(function (p) { return p.node === hero; });
    if (heroPaid) {
      /* the watched node's UI follows the Stratus beam: it reads "Now" from the block until the beam lands (the last to leave, 2140 ms), then the feed row, the toast and the queue reset arrive together */
      var payAt = globe.reduced ? 860 : 2140, since = performance.now() - t0;
      S.heroPaying = true;
      var pe0 = $('#pay-eta'); if (pe0) pe0.textContent = 'Now'; var po0 = $('#op-next'); if (po0) po0.textContent = 'Now';
      var paid = function () {
        S.heroPaying = false; S.heroPaid = true;
        pushEvent({ kind: 'mine', cls: 'p1', text: 'Watched node paid +9.00 FLUX', meta: '65.109.26.93:16147, Stratus, block ' + f0(S.tip), tier: 2 });
        if (!S.frozen) toast({ cls: 'is-pay', icon: 'coins', color: 'var(--tier-stratus)', title: 'Payment received, +9.00 FLUX', text: '<span class="mono">65.109.26.93:16147</span> Stratus, block <span class="mono">' + f0(S.tip) + '</span>. Back of the queue, next in about 14.7 h.' });
        var pe = $('#pay-eta'); if (pe) { pe.textContent = 'in 14.7 h'; } var po = $('#op-next'); if (po) po.textContent = 'in 15.2 h';
      };
      if (S.frozen) { if (since >= payAt) paid(); } else setTimeout(paid, Math.max(0, payAt - since));
    }
    L.payees.forEach(function (p, i) { /* payout rows, staggered */ });
    if (!o.quiet) setTimeout(function () { setAimNext(); if (body.dataset.mode === 'ambient') ambCaption(); }, 2600);
    tick(true);
  }
  function setAimNext() {
    var L = randomLanding(), n = D.nodes;
    D.landing.payees = L.payees; D.landing.producer = L.producer;
    var list = L.payees.map(function (p, i) { var h = cityOf(p.node); return { node: p.node, tier: p.tier, amount: p.amount, label: h, dx: [24, -96, 24][i], dy: [14, 22, -24][i] }; });
    globe.setAim(list, Math.max(0, S.nextAt - S.now()) * 1000);
    var chips = $('#aimstrip'); var s = '<span class="lead">Next payout in <b id="aim-cd">30 s</b></span>';
    list.slice().reverse().forEach(function (p) { s += '<span class="aimchip" data-tier="' + tierName[p.tier] + '"><span data-tier-meter="' + tierName[p.tier] + '" data-s="13"></span>' + p.label + ' <i>' + p.amount.toFixed(1) + '</i></span>'; });
    chips.innerHTML = s; window.atlasHydrate(chips);
  }

  /* random network events so the feed breathes */
  var evPool = [
    function () { var i = Math.floor(D.rng() * D.nodes.n), t = D.nodes.tier[i]; return { kind: 'join', cls: 'p2', tier: t, text: 'Node joined, ' + tierLabel[t] + ' in ' + cityOf(i), meta: D.nodes.ip[i] + ':' + D.nodes.port[i], _idx: i }; },
    function () { return { kind: 'heartbeat', cls: 'p3', text: 'Confirmed ' + (12 + Math.floor(D.rng() * 5)) + ' nodes', meta: 'block ' + f0(S.tip) }; },
    function () { var k = Math.floor(D.rng() * 3); return { kind: 'app', cls: 'p2', text: ['Fluxtracker updated, 2 instances', 'Aave updated, 6 instances', 'FluxExport deployed, 3 instances'][k], meta: ['spec v6', 'spec v12', 'new app'][k] + ', ' + f2(3 + D.rng() * 20) + ' FLUX' }; },
    function () { return { kind: 'leave', cls: 'p2', text: 'Node expired, no check-in for 640 blocks', meta: '213.32.246.' + Math.floor(D.rng() * 250) + ':16167', tier: 0 }; }
  ];
  function randomEvent() { var e = evPool[Math.floor(D.rng() * evPool.length)](); if (e._idx != null) globe.play({ kind: 'join', node: e._idx }); pushEvent(e); }

  /* ---------- scroll edge: a window body fades at its bottom only while there is more to read ---------- */
  function edge(el) { el.classList.toggle('more', el.scrollHeight - el.scrollTop - el.clientHeight > 6); }
  function edgeAll() { $$('.win-body').forEach(edge); }
  document.addEventListener('scroll', function (e) { var t = e.target; if (t && t.classList && t.classList.contains('win-body')) edge(t); }, true);
  window.addEventListener('resize', edgeAll);

  /* ---------- ticking ---------- */
  var lastSec = -1, lastEvent = 0;
  function tick(force) {
    var now = S.now(), cd = S.nextAt - now, beat = Math.min(1, Math.max(0, (now - S.tipTime) / 30));
    root.style.setProperty('--beat', beat.toFixed(3)); if (globe.setBeat) globe.setBeat(beat);
    var sec = Math.floor(now);
    if (sec !== lastSec || force) {
      lastSec = sec; edgeAll();
      var c = Math.max(0, Math.ceil(cd));
      $('#cd').textContent = c; var g = $('#g-cd'); if (g) g.textContent = c;
      var a = $('#aim-cd'); if (a) a.textContent = c + ' s';
      var we = $('#wheel-eta'); if (we) we.textContent = c + ' s';
      var abt = $('#ab-tip'); if (abt) abt.textContent = f0(S.tip); var abc = $('#ab-cd'); if (abc) abc.textContent = c; var abd = $('#ab-cd2'); if (abd) abd.textContent = c; var abu = $('#ab-cut'); if (abu) abu.textContent = f0(D.emission.cutHeight - S.tip);
      var mtip = $('#moon-tip-cd'); if (mtip) mtip.textContent = c;
      var on = $('#op-next'); if (on && !S.heroPaid && !S.heroPaying) on.textContent = c + ' s';
      var pe = $('#pay-eta'); if (pe && !S.heroPaid && !S.heroPaying) pe.textContent = c < 4 ? 'Now' : (c + ' s');
      $('#clock').textContent = fmtClock(now) + ' UTC';
      var ab = $('#amb-blk'); if (ab) ab.textContent = 'Block ' + f0(S.tip) + ' · ' + ageText(now - S.tipTime) + ' ago';
      var at = $('#amb-t'); if (at) at.textContent = fmtClock(now).slice(0, 5); var acd = $('#amb-cd'); if (acd) acd.textContent = c;
      $$('[data-ts]').forEach(function (el) { var t = el.querySelector('time') || el; if (el.tagName === 'TIME') el.textContent = ageText(now - el.dataset.ts); else if (el.classList.contains('evt')) el.querySelector('time').textContent = ageText(now - el.dataset.ts); });
      var ci = $('#checkin'); if (ci) { var blocksSince = 16 + (S.tip - D.clock.tip); ci.textContent = blocksSince; var gg = $('#gauge'); if (gg) gg.style.setProperty('--at', (blocksSince / 640 * 100).toFixed(1) + '%'); }
      var tc = $('#tx-conf'); if (tc) tc.textContent = D.tx.confirmationsAtTip + (S.tip - D.clock.tip);
      var cb = $('#cut-blocks'); if (cb) cb.firstChild.nodeValue = f0(D.emission.cutHeight - S.tip);
      if (c <= 0 && !S.frozen && !S.landing) { S.landing = true; landBlock(); setTimeout(function () { S.landing = false; }, 3000); }
      if (!S.frozen && now - lastEvent > 3.2 + D.rng() * 3) { lastEvent = now; randomEvent(); }
    }
  }
  function loop() { tick(false); requestAnimationFrame(loop); }

  /* ---------- tether ---------- */
  function updateTether() {
    var t = $('#tether'); var w = $('.win-wrap'), isAbout = S.view === 'about';
    if (!(S.view === 'node' || S.view === 'palette' || S.view === 'landing' || isAbout) || !w || (!isAbout && globe.sel < 0)) { t.innerHTML = ''; requestAnimationFrame(updateTether); return; }
    var p = isAbout ? (function () { var ms = globe.moonState(); return { x: ms.x + ms.s * 0.54 - 13, y: ms.y - ms.s * 0.54 + 13, visible: ms.visible }; /* starts just outside the hex ring, never across the symbol */ })() : globe.project(D.nodes.lat[globe.sel], D.nodes.lon[globe.sel], 0);
    if (!p.visible) { t.innerHTML = ''; requestAnimationFrame(updateTether); return; }
    var r = w.getBoundingClientRect(), ey = r.top + 26, ex = r.left + 1;
    var sx = p.x + 13, sy = p.y - 13, dy = ey - sy, dx = Math.abs(dy), kx = Math.min(sx + dx, ex - 24), ky = sy + (kx - sx) * (dy < 0 ? -1 : 1);
    var pts = [[sx, sy], [kx, ky], [ex, ky]]; if (Math.abs(ky - ey) > 1) pts.push([ex, ey]);
    var seg = [], L = 0; for (var i = 1; i < pts.length; i++) { var l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); L += l; }
    var u = S.tetherT0 ? Math.min(1, (performance.now() - S.tetherT0 - 180) / 520) : 1; u = u < 0 ? 0 : 1 - Math.pow(1 - u, 3);
    var want = L * u, d = 'M' + sx.toFixed(1) + ' ' + sy.toFixed(1), last = pts[0];
    for (var k = 1; k < pts.length && want > 0; k++) { var take = Math.min(seg[k - 1], want); var f = take / seg[k - 1]; last = [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f]; d += ' L' + last[0].toFixed(1) + ' ' + last[1].toFixed(1); want -= take; }
    t.innerHTML = '<path class="glow" d="' + d + '"/><path d="' + d + '"/>' + (u >= 1 ? '<circle class="end" cx="' + ex + '" cy="' + ey + '" r="2.4"/>' : '<circle class="end" cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.4"/>');
    requestAnimationFrame(updateTether);
  }

  /* ---------- palette ---------- */
  var palIdx = 0;
  function hl(t) { var q = $('#pal-input').value.trim(); if (!q || t.indexOf('<') >= 0) return t; var i = t.toLowerCase().indexOf(q.toLowerCase()); return i < 0 ? t : t.slice(0, i) + '<mark>' + t.slice(i, i + q.length) + '</mark>' + t.slice(i + q.length); }
  function renderPalette() {
    var rows = V.paletteRows($('#pal-input').value), h = '', n = 0;
    rows.forEach(function (g) {
      h += '<div class="pal-group">' + g.g + '</div>';
      g.rows.forEach(function (r) {
        var ic = r.ic === 'fluxmark' ? window.FluxBrand.mark({ size: 15, fill: '#ffffff' }) : (/^(cumulus|nimbus|stratus)$/.test(r.ic) ? window.atlasTier(r.ic, 16) : I(r.ic, { size: 16 }));
        h += '<div class="pal-row' + (n === palIdx ? ' is-active' : '') + '" role="option" style="--k:' + r.k + '"><span class="ic">' + ic + '</span><span class="tx"><b' + (r.m ? ' class="mono"' : '') + '>' + hl(r.t) + '</b><small>' + r.s + '</small></span><span class="meta">' + r.meta + (n === palIdx ? '<span class="kbd">enter</span>' : '') + '</span></div>'; n++;
      });
    });
    $('#pal-list').innerHTML = h;
  }
  function openPalette() { $('#palette-layer').hidden = false; renderPalette(); setTimeout(function () { $('#pal-input').focus(); var l = $('#pal-input'); l.setSelectionRange(l.value.length, l.value.length); }, 0); }
  function closePalette() { $('#palette-layer').hidden = true; }
  $('#omni').addEventListener('click', openPalette);
  $('#palette-layer').addEventListener('mousedown', function (e) { if (e.target === this) closePalette(); });
  $('#pal-input').addEventListener('input', renderPalette);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#palette-layer').hidden ? openPalette() : closePalette(); }
    else if (e.key === 'Escape') { if (!$('#palette-layer').hidden) closePalette(); else if (body.dataset.mode === 'ambient') exitAmbient(); }
    else if (!$('#palette-layer').hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); palIdx = Math.max(0, palIdx + (e.key === 'ArrowDown' ? 1 : -1)); renderPalette(); }
    else if (e.key === 'A' && e.shiftKey) { enterAmbient(); }
  });

  /* ---------- dock ---------- */
  $$('.dock .dk').forEach(function (b) {
    b.addEventListener('click', function () {
      var o = b.dataset.open; if (!o) return; var r = b.getBoundingClientRect();
      if (o === 'globe') { applyView('bare'); return; }
      if (o === 'ambient') { enterAmbient(); return; }
      applyView(o, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    });
  });
  /* window controls: close returns to the bare globe */
  document.addEventListener('click', function (e) { var c = e.target.closest('.win-bar .close'); if (c) { var ww = c.closest('.win-wrap'); if (ww) ww.classList.add('is-closing'); setTimeout(function () { $('#windows').innerHTML = ''; }, 200); globe.select(-1); globe.setInset({ left: DOCK, right: 0, top: 96, bottom: BOT }, 360); $$('.dock .dk').forEach(function (b) { b.classList.remove('is-open', 'is-focus'); }); $('.dock .dk').classList.add('is-focus'); } });

  /* ---------- ambient ---------- */
  var idleTimer = null, prevView = 'node';
  function enterAmbient() { prevView = S.view; applyView('ambient'); fillAmbient(); }
  function exitAmbient() { applyView(prevView === 'ambient' ? 'node' : prevView); }
  function fillAmbient() {
    ambCaption();
    var tk = $('#amb-tick'), items = S.feed.slice(-4).reverse();
    tk.innerHTML = items.map(function (e, i) { var ic = icoFor[e.kind] || 'activity'; return '<div class="e k-' + e.kind + '" style="--i:' + i + ';--ev:' + ({ block: 'var(--accent-400)', mine: 'var(--hot)', join: 'var(--tier-stratus)', leave: 'var(--status-warn)', app: 'var(--accent-app)', heartbeat: 'var(--text-3)', 'app-pending': 'var(--text-3)', version: 'var(--accent-300)' }[e.kind] || 'var(--text-3)') + '"><span class="ei">' + I(ic, { size: 16 }) + '</span><div>' + e.text + '<small>' + (e.meta || '') + '</small></div></div>'; }).join('');
  }
  function ambCaption() {
    var L = D.landing, n = D.nodes, prod = cityOf(L.producer), pay = L.payees.slice().sort(function (a, b) { return b.tier - a.tier; }).map(function (p) { return cityOf(p.node); });
    var l1 = $('#amb-l1'), l2 = $('#amb-l2'); if (l1) l1.textContent = 'Block ' + f0(S.tip) + ' came from ' + prod + '.'; if (l2) l2.innerHTML = 'Paid to ' + pay[0] + ', ' + pay[1] + ' and ' + pay[2] + '. The next block lands in <b id="amb-cd">' + Math.max(0, Math.ceil(S.nextAt - S.now())) + '</b> s.';
  }
  $('#btn-ambient').addEventListener('click', enterAmbient);
  $('#ambient').addEventListener('mousemove', function (e) { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 8) exitAmbient(); });
  $('#ambient').addEventListener('click', exitAmbient);

  /* ---------- time machine ---------- */
  function buildTimeline(open) {
    var tl = $('#timeline');
    if (!open) { tl.innerHTML = '<div class="tl-label">' + I('history', { size: 13 }) + 'Time machine <span class="kbd">T</span></div><div class="tl-track"><span class="tl-now"></span></div><span class="tl-live">Live</span>'; return; }
    var pts = [], n = 120; for (var i = 0; i < n; i++) pts.push(6330 + 400 * (i / n) + 50 * Math.sin(i / 7) + 28 * Math.sin(i / 2.3));
    var w = W - 130 - 40, h = 34, mn = Math.min.apply(null, pts) - 40, mx = Math.max.apply(null, pts) + 40, path = pts.map(function (v, i) { return (i ? 'L' : 'M') + (i / (n - 1) * w).toFixed(1) + ' ' + (h - (v - mn) / (mx - mn) * h).toFixed(1); }).join(' ');
    /* the axis runs from Sep 1 00:00 to now (Sep 30 19:46 UTC = 29.82 days); the handle sits at Sep 26 08:00 = 25.33 days */
    var SPAN = 29.82, at = 25.33 / SPAN, ticks = ''; [1, 6, 11, 16, 21, 26].forEach(function (day) { ticks += '<span style="position:absolute;left:' + ((day - 1) / SPAN * 100).toFixed(2) + '%;top:38px;font:500 10px/1 var(--font-mono);color:var(--text-4);translate:-50% 0">Sep ' + day + '</span>'; });
    tl.innerHTML = '<div class="tl-label" style="flex-direction:column;align-items:flex-start;gap:6px;width:160px;align-self:center;margin-top:6px">' +
      '<span style="display:flex;align-items:center;gap:8px;color:var(--accent-time)">' + I('history', { size: 14 }) + '<b style="color:var(--text-1);font-weight:500;font-size:12px">Time machine</b></span>' +
      '<span style="display:flex;gap:4px"><button class="btn btn--sm btn--icon" aria-label="Rewind">' + I('rewind', { size: 13 }) + '</button><button class="btn btn--sm btn--icon" aria-label="Play">' + I('play', { size: 13 }) + '</button><button class="btn btn--sm">x60</button></span></div>' +
      '<div style="position:relative;flex:1;height:60px;margin-top:4px"><svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="position:absolute;left:0;top:6px;overflow:visible"><path d="' + path + ' L' + w + ' ' + h + ' L0 ' + h + ' Z" fill="var(--accent-time)" opacity=".10"/><path d="' + path + '" fill="none" stroke="var(--accent-time)" stroke-width="1.5" opacity=".9"/></svg>' + ticks +
      '<div style="position:absolute;left:' + (at * 100) + '%;top:0;bottom:26px;width:2px;background:var(--hot);box-shadow:var(--glow-hot);translate:-1px 0"></div><div style="position:absolute;left:' + (at * 100) + '%;top:-20px;translate:-50% 0;height:22px;padding:0 10px;border-radius:11px;background:var(--hot);color:#080a0f;font:600 11px/22px var(--font-mono);white-space:nowrap">2026-09-26 08:00 UTC</div></div>' +
      '<button class="btn btn--primary" style="margin:6px 0 0 12px;align-self:center">Return to live</button>';
  }
  function showArchiveChip() {
    var e = document.createElement('div'); e.id = 'archchip'; e.className = 'aimstrip glass'; e.style.setProperty('--aim-x', (W / 2 + 20) + 'px');
    e.innerHTML = '<span class="lead" style="color:var(--accent-time)">' + I('history', { size: 15 }) + '<b style="color:var(--text-1)">Archive view</b> 4 d 11 h ago</span><span class="chip chip--mono">6,512 nodes</span><span class="chip chip--mono">block 2,978,201</span><button class="btn btn--sm btn--pill" style="background:var(--accent-600);border:0;color:#fff">Return to live</button>';
    document.body.appendChild(e);
  }
  function showWeatherChip() {
    var e = document.createElement('div'); e.id = 'wxchip'; e.className = 'aimstrip glass'; e.style.setProperty('--aim-x', (W / 2 + 10) + 'px');
    e.innerHTML = '<span class="lead" style="color:var(--text-1)">' + I('cloud-rain', { size: 15 }) + '<b style="color:var(--text-1)">Network weather</b></span><span class="chip chip--status" data-status="ok"><i class="dot"></i>Healthy</span><span class="chip chip--mono">153 unreachable</span><span class="chip chip--mono">11 at risk</span><span class="chip" style="gap:10px"><span style="display:inline-flex;align-items:center;gap:5px"><i class="dot" style="background:var(--status-warn)"></i>Unsettled</span><span style="display:inline-flex;align-items:center;gap:5px"><i class="dot" style="background:var(--status-crit)"></i>Storm</span></span>';
    document.body.appendChild(e);
  }

  /* ---------- app constellation mini map ---------- */
  function drawConstMap() {
    var c = $('#constmap'); if (!c) return; var w = c.parentNode.clientWidth || 392, h = c.parentNode.clientHeight || 132, dpr = 2;
    c.width = w * dpr; c.height = h * dpr; var g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var box = [-22, 30, 50, 66]; /* lon min, lat min, lon max, lat max: Iberia to Finland */
    var X = function (lon) { return (lon - box[0]) / (box[2] - box[0]) * w; }, Y = function (lat) { return h - (lat - box[1]) / (box[3] - box[1]) * h; };
    var step = 0.9; g.fillStyle = 'rgba(79,122,212,.5)';
    for (var lat = box[1]; lat < box[3]; lat += step) { var ds = step / Math.cos(lat * Math.PI / 180) * 0.5; for (var lon = box[0]; lon < box[2]; lon += ds) { var cv = window.ATLAS_LAND.cover(lat, lon, 0.2); if (cv > 0.34) { g.globalAlpha = 0.4 + 0.45 * cv; g.beginPath(); g.arc(X(lon), Y(lat), 1.35, 0, 6.3); g.fill(); } } }
    g.globalAlpha = 1;
    var hel = geo(D.appNodes[0].idx), mai = geo(D.appNodes[2].idx);
    var p1 = [X(hel.lon), Y(hel.lat)], p2 = [X(mai.lon), Y(mai.lat)];
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.2; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(p2[0], p2[1]); g.quadraticCurveTo((p1[0] + p2[0]) / 2 - 10, Math.min(p1[1], p2[1]) - 34, p1[0], p1[1]); g.stroke(); g.setLineDash([]);
    [[p1, 2, 'Helsinki x2'], [p2, 0, 'Maia']].forEach(function (p) {
      var gr = g.createRadialGradient(p[0][0], p[0][1], 0, p[0][0], p[0][1], 18); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(p[0][0], p[0][1], 18, 0, 6.3); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(p[0][0], p[0][1], 3.6, 0, 6.3); g.fill(); g.strokeStyle = p[1] === 2 ? '#ffc857' : '#36d3ff'; g.lineWidth = 1.6; g.beginPath(); g.arc(p[0][0], p[0][1], 6.2, 0, 6.3); g.stroke();
      g.font = '500 11px "IBM Plex Mono"'; var tw = g.measureText(p[2]).width; g.fillStyle = 'rgba(8,10,15,.78)'; g.beginPath(); g.roundRect(p[0][0] + 11, p[0][1] - 18, tw + 14, 17, 8.5); g.fill(); g.fillStyle = '#d5d7db'; g.fillText(p[2], p[0][0] + 18, p[0][1] - 6);
    });
  }

  /* ---------- globe events ---------- */
  var tip = null;
  function ensureTip() { if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip); } return tip; }
  globe.on('hover', function (e) {
    ensureTip();
    if (e.idx < 0) { tip.hidden = true; document.body.style.cursor = ''; $('#globe').style.cursor = ''; return; }
    var n = D.nodes, t = n.tier[e.idx];
    if (e.site) { var s = e.site; tip.innerHTML = '<b>' + D.hubs[s.hub].name + '</b><div class="row"><span>' + f0(s.n) + ' nodes at this site</span></div><div class="row">' + [0, 1, 2].map(function (k) { return '<span style="display:inline-flex;align-items:center;gap:5px;color:var(--tier-' + tierName[k] + ')">' + window.atlasTier(tierName[k], 12) + '<span style="color:var(--text-2)" class="mono">' + f0(s.t[k]) + '</span></span>'; }).join('') + '</div>'; }
    else tip.innerHTML = '<b class="mono">' + n.ip[e.idx] + ':' + n.port[e.idx] + '</b><div class="row">' + V.chipTier(t) + '<span>' + D.hubs[n.hub[e.idx]].name + '</span></div>';
    tip.style.left = (e.x + 14) + 'px'; tip.style.top = (e.y + 14) + 'px'; tip.hidden = false; window.atlasHydrate(tip); $('#globe').style.cursor = 'pointer';
  });
  globe.on('hovermove', function (e) { if (tip && !tip.hidden) { tip.style.left = (e.x + 14) + 'px'; tip.style.top = (e.y + 14) + 'px'; } });
  /* click any node or tower: the inspector retargets, the tether re-routes, the beacon moves */
  function selectNode(idx, fly) {
    curNode = idx;
    var c = CFG.node;
    if (!(S.view === 'node' || S.view === 'palette' || S.view === 'landing')) { applyView('node', null); }
    else {
      var host = $('#windows'), r = dockedRect(INSP); host.innerHTML = V.node(r.x, r.y, r.w, r.h, idx); window.atlasHydrate(host);
      var w = $('.win-wrap', host); if (w) { w.classList.add('is-swap'); setTimeout(function () { w.classList.remove('is-swap'); }, 360); }
      S.tetherT0 = performance.now(); globe.select(idx);
    }
    if (fly) globe.flyTo({ lat: D.nodes.lat[idx] * 0.6 + 20, lon: D.nodes.lon[idx] - 8, size: 120 }, 1300);
    tip && (tip.hidden = true);
  }
  globe.on('click', function (e) { if (e.idx >= 0) selectNode(e.idx, false); });


  /* ---------- the moon: hover, click, keyboard ---------- */
  var moonTip = null, moonHit = $('#moon-hit');
  function ensureMoonTip() { if (!moonTip) { moonTip = document.createElement('div'); moonTip.className = 'tip moon-tip'; moonTip.hidden = true; document.body.appendChild(moonTip); } return moonTip; }
  function moonTipHtml() {
    return '<span class="tt">' + window.FluxBrand.mark({ size: 14, fill: '#ffffff' }) + 'Flux chain</span><div class="row"><span>Block</span><b class="mono">' + f0(S.tip) + '</b></div><div class="row"><span>Next block in</span><b class="mono"><span id="moon-tip-cd">' + Math.max(0, Math.ceil(S.nextAt - S.now())) + '</span> s</b></div><div class="row"><span>Network</span><b class="mono">' + f0(D.network.nodes) + ' nodes</b></div><div class="hint">' + I('mouse-pointer-click', { size: 12 }) + 'Click for About Flux<span class="kbd" style="margin-left:auto">M</span></div>';
  }
  function placeMoonTip() {
    var ms = globe.moonState(); if (!moonTip) return; var w = moonTip.offsetWidth || 230, x = ms.x - ms.s * 0.7 - w - 8, y = ms.y - 34;
    if (x < 96) x = ms.x + ms.s * 0.7 + 8; if (y < TOP + 8) y = TOP + 8;
    moonTip.style.left = x + 'px'; moonTip.style.top = y + 'px';
  }
  globe.on('moonhover', function (e) {
    ensureMoonTip(); $('#globe').style.cursor = e.on ? 'pointer' : ''; if (tip) tip.hidden = true;
    if (e.on) { moonTip.innerHTML = moonTipHtml(); window.atlasHydrate(moonTip); moonTip.hidden = false; placeMoonTip(); } else moonTip.hidden = true;
  });
  function openAbout(fromKey) { var ms = globe.moonState(); if (moonTip) moonTip.hidden = true; if (S.view === 'about') return; applyView('about', { x: ms.x, y: ms.y }); }
  globe.on('moonclick', function () { openAbout(); });
  moonHit.addEventListener('click', function () { openAbout(true); });
  moonHit.addEventListener('focus', function () { globe.moon.hoverOn = true; ensureMoonTip(); moonTip.innerHTML = moonTipHtml(); window.atlasHydrate(moonTip); moonTip.hidden = false; placeMoonTip(); });
  moonHit.addEventListener('blur', function () { globe.moon.hoverOn = false; if (moonTip) moonTip.hidden = true; });
  function trackMoon() {
    var ms = globe.moonState(); moonHit.style.left = ms.x + 'px'; moonHit.style.top = ms.y + 'px'; var d = Math.max(44, ms.s * 1.5); moonHit.style.width = d + 'px'; moonHit.style.height = d + 'px'; moonHit.hidden = !ms.visible || body.dataset.mode === 'ambient';
    if (moonTip && !moonTip.hidden) placeMoonTip();
    requestAnimationFrame(trackMoon);
  }
  requestAnimationFrame(trackMoon);

  /* ---------- boot of the page ---------- */
  renderRail(); renderFeed(false);
  window.atlasHydrate();
  applyView(view === 'landing' || view === 'palette' ? view : (CFG[view] ? view : 'node'));
  if (view === 'ambient') fillAmbient();
  if (view === 'palette') openPalette();
  if (view === 'app') { setTimeout(drawConstMap, 50); }
  S.frozenAt = 12;
  if (freeze) { S.frozen = true; }
  if (view === 'landing') {
    var t = performance.now(), at = parseFloat(qs.get('at') || '760');
    S.frozen = true; S.frozenAt = 12;
    landBlock({ t0: t - at, quiet: true });
    globe.freezeAt(t);
    globe.aim = [];
    /* the landing already advanced the tip; keep the ghost consistent */
  }
  if (!freeze && view !== 'landing') { requestAnimationFrame(loop); }
  else { tick(true); }
  requestAnimationFrame(updateTether);

  /* ---------- window drag, raise, snap ---------- */
  var dragging = null;
  document.addEventListener('pointerdown', function (e) {
    var bar = e.target.closest('.win-bar'); if (!bar || e.target.closest('button')) return;
    var w = bar.closest('.win-wrap'), r = w.getBoundingClientRect();
    dragging = { w: w, dx: e.clientX - r.left, dy: e.clientY - r.top, pid: e.pointerId }; w.classList.add('is-dragging'); try { bar.setPointerCapture(e.pointerId); } catch (x) { }
  });
  document.addEventListener('pointermove', function (e) {
    if (!dragging) return; var w = dragging.w;
    var x = Math.max(DOCK - 40, Math.min(W - 160, e.clientX - dragging.dx)), y = Math.max(TOP + 4, Math.min(H - 120, e.clientY - dragging.dy));
    w.style.left = x + 'px'; w.style.top = y + 'px'; w.style.right = 'auto';
    var snapR = x + w.offsetWidth > W - 24, snapL = x < DOCK + 18; w.classList.toggle('snap-r', snapR); w.classList.toggle('snap-l', snapL);
  });
  function endDrag() {
    if (!dragging) return; var w = dragging.w, r = w.getBoundingClientRect();
    if (w.classList.contains('snap-r')) { w.style.left = (W - r.width - GAP) + 'px'; w.style.top = (TOP + GAP) + 'px'; r = { left: W - r.width - GAP, right: W - GAP, width: r.width }; }
    else if (w.classList.contains('snap-l')) { w.style.left = (DOCK + 16) + 'px'; r = { left: DOCK + 16, right: DOCK + 16 + r.width, width: r.width }; }
    w.classList.remove('is-dragging', 'snap-r', 'snap-l');
    /* the globe re-centres in the space the window leaves free */
    var cx = r.left + r.width / 2, ins = cx > W / 2 ? { left: DOCK, right: W - r.left + 12, top: 40, bottom: 128 } : { left: r.right + 12, right: 0, top: 40, bottom: 128 };
    globe.setInset(ins, 420); layoutAim({ inset: ins });
    dragging = null;
  }
  document.addEventListener('pointerup', endDrag); document.addEventListener('pointercancel', endDrag);
  document.addEventListener('pointerdown', function (e) { var w = e.target.closest('.win-wrap'); if (w) { $$('.win-wrap').forEach(function (o) { o.classList.toggle('is-focus', o === w); o.style.zIndex = o === w ? 42 : 41; }); } });

  $('.brand').addEventListener('click', function () { applyView('bare'); });

  /* ---------- keyboard: every dock item has a key ---------- */
  var keymap = { g: 'globe', n: 'node', a: 'app', e: 'tx', q: 'queue', s: 'analytics', t: 'time', o: 'operator', w: 'weather', m: 'about', '`': 'terminal' };
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA)$/.test((e.target || {}).tagName || '')) return;
    if (!$('#palette-layer').hidden) return;
    var k = e.key.toLowerCase(); if (e.shiftKey && k === 'a') return;
    if (keymap[k]) { var b = $('.dock .dk[data-open="' + keymap[k] + '"]'); if (b) { e.preventDefault(); b.click(); } }
  });

  /* ---------- arriving from the boot screen: the chrome assembles around the globe ---------- */
  if (qs.get('from') === 'boot') {
    body.classList.add('is-assembling'); setTimeout(function () { body.classList.remove('is-assembling'); }, 2400);
    globe.pose.lat = 40; globe.pose.lon = -14; globe.pose.size = 96;
  }

  /* debug / screenshot hooks */
  window.atlasMock = { about: openAbout, land: landBlock, apply: applyView, palette: openPalette, toast: toast, S: S, globe: globe, event: randomEvent, ambient: enterAmbient };
})();
