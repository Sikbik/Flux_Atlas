/* Flux Atlas design mock: phone behaviours. One bottom sheet hosts the same content components the desktop shows in windows.
   Query: ?screen=node|live|search|apps|you|about  &snap=peek|half|tall|full  &freeze=1  &toast=1  &landing=1&at=650 */
(function () {
  'use strict';
  var D = window.ATLAS_DATA, V = window.ATLAS_VIEWS, I = window.atlasIcon;
  var qs = new URLSearchParams(location.search);
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var f0 = V.f0, tierName = ['cumulus', 'nimbus', 'stratus'], tierLabel = ['Cumulus', 'Nimbus', 'Stratus'];
  var W = window.innerWidth, H = window.innerHeight, freeze = qs.get('freeze') === '1' || qs.get('landing') === '1';
  var S = { tip: D.clock.tip, tipTime: D.clock.tipTime, nextAt: D.clock.tipTime + 30, base: D.clock.demoNow, t0: performance.now() };
  S.now = function () { return freeze ? S.base : S.base + (performance.now() - S.t0) / 1000; };
  var ageText = function (s) { s = Math.max(0, Math.floor(s)); return s < 4 ? 'now' : (s < 60 ? s + ' s' : (s < 3600 ? Math.floor(s / 60) + ' min' : Math.floor(s / 3600) + ' h')); };
  var hero = D.hero.idx;

  var globe = new window.AtlasGlobe($('#globe'), D, { dprCap: 3, moonScale: 0.86 });
  globe.setMoon({ padTop: 38, phase: -2.35 }); /* below the aim chips; starts over the Atlantic, clear of the selected node */
  window.atlasGlobe = globe;
  globe.setLayers({ labels: false, aimLabels: false, mesh: 'selection' });
  globe.fleetRf = 60;
  var SAFE_T = 47, TAB = 90;
  var FULL = H - TAB - SAFE_T - 16, TALL = H - TAB - 250, HALF = 372, PEEK = 132;
  var snapPx = { peek: PEEK, half: HALF, tall: TALL, full: FULL };

  /* ---------- content: reuse the desktop components ---------- */
  function extract(html) {
    var t = document.createElement('div'); t.innerHTML = html;
    return { ap: $('.ap', t).outerHTML, ttl: $('.ttl', t).innerHTML, body: $('.win-body', t).innerHTML, tier: $('.win-wrap', t).dataset.tier || '', accent: $('.win-wrap', t).dataset.accent || '' };
  }

  /* phone order: chips, the payment tile, then place and actions */
  function reorderNode(html) {
    var t = document.createElement('div'); t.innerHTML = html;
    var id = $('.idstrip', t), chips = $('.row', id), loc = $('.loc', id), act = $('.actions', id), pay = $('.sec', t);
    var c = document.createElement('div'); c.className = 'sh-chips'; c.innerHTML = chips.innerHTML;
    var l = document.createElement('div'); l.className = 'sh-loc'; l.innerHTML = loc.innerHTML;
    var a = document.createElement('div'); a.className = 'sh-actions'; a.innerHTML = act.innerHTML;
    id.remove(); var paySec = $('.sec', t); paySec.style.borderTop = '0'; paySec.style.paddingTop = '0';
    t.insertBefore(c, t.firstChild);
    paySec.parentNode.insertBefore(l, paySec.nextSibling); l.parentNode.insertBefore(a, l.nextSibling);
    return t.innerHTML;
  }

  function headHTML(x, fresh) { return '<div class="grab"><i></i></div><header class="sh-head"><span class="ap">' + x.ap.replace(/^<span class="ap">|<\/span>$/g, '') + '</span><div class="ttl">' + x.ttl + '</div><span class="fresh">' + (fresh || '4 s') + '</span><button class="x" aria-label="Close">' + I('x', { size: 17 }) + '</button></header>'; }

  function liveBody() {
    var L = D.landing, pay = L.payees, rows = '';
    [{ t: 2, c: 'Helsinki', a: '9.0', me: true, ip: '65.109.26.93:16147' }, { t: 1, c: 'Raleigh', a: '3.5', ip: '38.247.82.140:16147' }, { t: 0, c: 'Taganrog', a: '1.0', ip: '80.72.20.160:16137' }].forEach(function (r) {
      rows += '<div class="nxrow' + (r.me ? ' mine' : '') + '" data-tier="' + tierName[r.t] + '"><span class="t">' + window.atlasTier(tierName[r.t], 18) + '</span><div>' + r.c + ' <span class="dim">' + tierLabel[r.t] + '</span><small>' + r.ip + (r.me ? ', watching' : '') + '</small></div><span class="amt">+' + r.a + '0</span></div>';
    });
    var ev = D.feed.slice(-5).reverse().map(function (e) {
      var ic = { block: 'blocks', mine: 'eye', join: 'rocket', leave: 'triangle-alert', app: 'boxes', 'app-pending': 'hourglass', heartbeat: 'activity', version: 'badge-check' }[e.kind] || 'activity';
      return '<li class="evt k-' + e.kind + '"' + (e.tier != null ? ' data-tier="' + tierName[e.tier] + '"' : '') + '><span class="ei">' + I(ic, { size: 14 }) + '</span><div><span class="t">' + e.text.replace(/(\b\d[\d,.]*\d\b)/g, '<b>$1</b>') + '</span><span class="sub">' + (e.meta || '') + '</span></div><time>' + ageText(e.age) + '</time></li>';
    }).join('');
    var blocks = D.blocks.slice(0, 6).map(function (b) {
      var p = b.prod, t = p.tier, pct = [1, 3.5, 9, 0.5].map(function (v) { return v / 14 * 100; });
      return '<article class="blk" data-tier="' + tierName[t] + '"><div class="r1"><b>' + f0(b.h) + '</b><time>' + ageText(S.now() - b.time) + '</time></div><div class="r2">' + b.tx + ' tx &middot; ' + (b.size / 1000).toFixed(1) + ' KB</div><div class="r3"><span class="pr">' + I('producer', { size: 14 }) + '</span>' + p.ip + '</div><div class="strip"><i style="width:' + pct[0] + '%;background:var(--tier-cumulus)"></i><i style="width:' + pct[1] + '%;background:var(--tier-nimbus)"></i><i style="width:' + pct[2] + '%;background:var(--tier-stratus)"></i><i style="width:' + pct[3] + '%;background:var(--text-4)"></i></div></article>';
    }).join('');
    return '<div class="lv-card lv-beat"><div class="bigring"><div class="beat-ring"></div><span class="core"></span></div><div><div class="k">Latest block</div><div class="n" id="lv-tip">' + f0(S.tip) + '</div><div class="s">next in <i id="lv-cd">18</i> s &middot; 20 tx waiting</div></div></div>' +
      '<div class="lv-card"><h3 style="margin:0 0 4px;font-size:15px;font-weight:600">Next payout</h3><div class="cap" style="margin-bottom:6px">Known one block ahead, paid in <b id="lv-cd2" style="color:var(--hot)">18</b> s</div>' + rows + '</div>' +
      '<div class="sh-sec" style="padding-bottom:8px"><h3>Pulse<span class="aside">live</span></h3></div><ul class="pulse-list lv-events" style="list-style:none;margin:0 0 12px;padding:0;max-height:none;-webkit-mask:none;mask:none;display:block">' + ev + '</ul>' +
      '<div class="sh-sec" style="padding-bottom:8px"><h3>Blocks<span class="aside">newest first</span></h3></div><div class="lv-blocks">' + blocks + '</div>';
  }

  var screens = {
    node: function () { var x = extract(V.node(0, 0, 390, 700)); x.body = reorderNode(x.body); return { x: x, head: headHTML(x, '4 s'), body: x.body, snap: 'half', globe: { lat: 46, lon: 12, size: 60, roll: -14, top: 160, bottom: HALF + TAB }, sel: true, aim: true, cons: null } ; },
    live: function () { return { x: { tier: '', accent: '' }, head: '<div class="grab"><i></i></div><header class="sh-head"><span class="ap" style="color:var(--accent-pulse)">' + I('activity', { size: 18 }) + '</span><div class="ttl"><b>Live</b><small>Everything happening on the network now</small></div><span class="fresh">now</span></header>', body: liveBody(), snap: 'tall', globe: { lat: 42, lon: -22, size: 58, roll: -14, top: 40, bottom: TALL + TAB - 90 }, sel: false, aim: false }; },
    apps: function () { var x = extract(V.app(0, 0, 390, 700)); return { x: x, head: headHTML(x, '41 s'), body: x.body, snap: 'half', globe: { lat: 52, lon: 4, size: 128, roll: -8, top: 120, bottom: HALF + TAB - 30 }, sel: false, aim: false, cons: true }; },
    you: function () { var x = extract(V.operator(0, 0, 390, 700)); return { x: x, head: headHTML(x, '4 s'), body: x.body, snap: 'half', globe: { lat: 60.2, lon: 24.9, size: 700, roll: 0, top: 150, bottom: HALF + TAB + 8 }, sel: false, aim: false, fleet: true }; }
  };
  screens.about = function () { var x = extract(V.about(0, 0, 390, 700)); return { x: x, head: headHTML(x, 'live'), body: x.body, snap: 'half', globe: { lat: 46, lon: 12, size: 60, roll: -14, top: 160, bottom: HALF + TAB }, sel: false, aim: false, cons: null, moon: true }; };
  screens.globe = screens.node;

  var cur = null;
  function show(name, snapOverride) {
    if (name === 'search') { document.body.dataset.screen = 'search'; renderResults(); return; }
    var key = name === 'globe' ? 'node' : name, c = screens[key]();
    cur = key; document.body.dataset.screen = key === 'live' ? 'live' : 'node'; document.body.dataset.sheet = key;
    var sh = $('#sheet'); sh.dataset.tier = c.x.tier || ''; if (c.x.accent) sh.dataset.accent = c.x.accent; else sh.removeAttribute('data-accent');
    sh.innerHTML = c.head + '<div class="sh-body">' + c.body + '</div>';
    window.atlasHydrate(sh);
    sh.dataset.snap = snapOverride || c.snap;
    $$('.ph-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === (name === 'node' || name === 'about' ? 'globe' : name)); });
    var g = c.globe; globe.setInset({ left: 0, right: 0, top: g.top, bottom: g.bottom }, qs.get('screen') ? 0 : 500);
    if (qs.get('screen') && !globe._moonPlaced) { globe.setMoon({ phase: key === 'you' ? -0.05 : -2.35 }); globe._moonPlaced = true; } /* static captures: park the moon where it covers nothing */
    if (qs.get('screen') || !globe._placed) { globe.setPose({ lat: g.lat, lon: g.lon, size: g.size, roll: g.roll }); globe._placed = true; } else globe.flyTo({ lat: g.lat, lon: g.lon, size: g.size }, 1100);
    globe.setLayers({ aim: !!c.aim, mesh: c.sel ? 'selection' : 'off', weather: false });
    if (c.sel) globe.select(hero); else globe.select(-1);
    globe.setConstellation(c.cons ? D.appNodes.map(function (o) { return o.idx; }) : (c.fleet ? D.heroHost.map(function (o) { return o.idx; }) : null), c.fleet ? 'mine' : 'app');
    $('.ph-search').style.display = key === 'live' ? 'none' : ''; $('#aim').style.display = (key === 'live' || !c.aim) ? 'none' : '';
    sizeGlobe();
    bindSheetDrag();
  }
  function sizeGlobe() { /* globe diameter follows the sheet: in 'height' mode it is a % of viewport height */ }

  /* ---------- aim chips ---------- */
  function aimChips() {
    var list = [{ t: 2, c: 'Helsinki', a: '9.0', me: true }, { t: 1, c: 'Raleigh', a: '3.5' }, { t: 0, c: 'Taganrog', a: '1.0' }];
    $('#aim').innerHTML = '<span class="lead">Next payout in <b id="aim-cd">18 s</b></span>' + list.map(function (p) { return '<span class="aimchip' + (p.me ? ' is-mine' : '') + '" data-tier="' + tierName[p.t] + '"><span data-tier-meter="' + tierName[p.t] + '" data-s="14"></span>' + p.c + ' <i>' + p.a + '</i></span>'; }).join('');
    window.atlasHydrate($('#aim'));
    globe.setAim([{ node: D.landing.payees[2].node, tier: 2, amount: 9, label: 'Helsinki' }, { node: D.landing.payees[1].node, tier: 1, amount: 3.5, label: 'Raleigh' }, { node: D.landing.payees[0].node, tier: 0, amount: 1, label: 'Taganrog' }], Math.max(0, S.nextAt - S.now()) * 1000);
  }

  /* ---------- sheet drag ---------- */
  var dragBound = false;
  function bindSheetDrag() {
    if (dragBound) return; dragBound = true;
    var sh = $('#sheet'), st = null;
    sh.addEventListener('pointerdown', function (e) { if (!e.target.closest('.grab, .sh-head')) return; st = { y: e.clientY, h: sh.getBoundingClientRect().height, t: performance.now() }; sh.classList.add('dragging'); sh.setPointerCapture(e.pointerId); });
    sh.addEventListener('pointermove', function (e) { if (!st) return; var h = Math.max(PEEK - 20, Math.min(FULL, st.h - (e.clientY - st.y))); sh.style.setProperty('--sheet-h', h + 'px'); sh.style.height = h + 'px'; });
    sh.addEventListener('pointerup', function (e) {
      if (!st) return; var h = sh.getBoundingClientRect().height, v = (st.y - e.clientY) / Math.max(1, performance.now() - st.t), best = 'half', bd = 1e9;
      var opts = cur === 'live' ? ['peek', 'half', 'tall', 'full'] : ['peek', 'half', 'full'];
      opts.forEach(function (k) { var d = Math.abs(snapPx[k] - (h + v * 160)); if (d < bd) { bd = d; best = k; } });
      sh.classList.remove('dragging'); sh.style.height = ''; sh.style.removeProperty('--sheet-h'); sh.dataset.snap = best; st = null;
      var ins = { peek: 132, half: HALF, tall: TALL - 90, full: FULL }[best] + TAB; globe.setInset({ left: 0, right: 0, top: cur === 'live' ? 40 : 160, bottom: Math.min(ins, H - 260) }, 420);
    });
  }

  /* ---------- search ---------- */
  function renderResults() {
    var rows = V.paletteRows($('#q').value), h = '', n = 0;
    rows.forEach(function (g) { h += '<div class="pal-group">' + g.g + '</div>'; g.rows.forEach(function (r) { var ic = r.ic === 'fluxmark' ? window.FluxBrand.mark({ size: 17, fill: '#ffffff' }) : (/^(cumulus|nimbus|stratus)$/.test(r.ic) ? window.atlasTier(r.ic, 18) : I(r.ic, { size: 18 })); h += '<div class="pal-row' + (n === 0 ? ' is-active' : '') + '" style="--k:' + r.k + '"><span class="ic">' + ic + '</span><span class="tx"><b' + (r.m ? ' class="mono"' : '') + '>' + r.t + '</b><small>' + r.s + '</small></span><span class="meta">' + (n === 0 ? '<span class="chip chip--status" data-status="ok" style="height:22px"><i class="dot"></i>Confirmed</span>' : '') + '</span></div>'; n++; }); });
    $('#results').innerHTML = h; window.atlasHydrate($('#results'));
  }
  $('#open-search').addEventListener('click', function () { show('search'); });
  $('#cancel').addEventListener('click', function () { show(cur === 'live' ? 'live' : 'node'); document.body.dataset.screen = cur === 'live' ? 'live' : 'node'; });
  $('#q').addEventListener('input', renderResults);
  $$('.ph-tabs button').forEach(function (b) { b.addEventListener('click', function () { var t = b.dataset.tab; if (t === 'search') { show('search'); return; } show(t); }); });

  $('#sheet').addEventListener('click', function (e) { if (e.target.closest('.x') && cur !== 'node') show('node'); });

  /* ---------- the moon: tap opens About Flux in the sheet; the DOM proxy carries keyboard and screen readers ---------- */
  var moonHit = $('#moon-hit');
  globe.on('moonclick', function () { if (cur !== 'about' && document.body.dataset.screen !== 'search') show('about'); });
  moonHit.addEventListener('click', function () { if (cur !== 'about') show('about'); });
  function trackMoon() {
    var ms = globe.moonState(), d = Math.max(44, ms.s * 1.5);
    moonHit.style.left = ms.x + 'px'; moonHit.style.top = ms.y + 'px'; moonHit.style.width = d + 'px'; moonHit.style.height = d + 'px';
    moonHit.hidden = !ms.visible || document.body.dataset.screen === 'search';
    requestAnimationFrame(trackMoon);
  }
  requestAnimationFrame(trackMoon);

  /* ---------- toast ---------- */
  function toast() {
    var t = document.createElement('div'); t.className = 'ph-toast';
    t.innerHTML = '<span class="ti">' + I('coins', { size: 20 }) + '</span><div><b>Payment received, +9.00 FLUX</b><p>65.109.26.93:16147 Stratus, block 2,996,930. Back of the queue, next in about 14.7 h.</p></div>';
    document.body.appendChild(t); window.atlasHydrate(t); setTimeout(function () { t.remove(); }, 6000);
  }

  /* ---------- clock ---------- */
  var lastSec = -1;
  function tick() {
    var now = S.now(), cd = Math.max(0, Math.ceil(S.nextAt - now)), beat = Math.min(1, Math.max(0, (now - S.tipTime) / 30));
    document.documentElement.style.setProperty('--beat', beat.toFixed(3)); if (globe.setBeat) globe.setBeat(beat);
    var sec = Math.floor(now); if (sec === lastSec) return; lastSec = sec;
    ['#cd', '#lv-cd', '#lv-cd2'].forEach(function (s) { var e = $(s); if (e) e.textContent = cd; });
    var a = $('#aim-cd'); if (a) a.textContent = cd + ' s';
    var pe = $('#pay-eta'); if (pe) pe.textContent = cd < 4 ? 'Now' : cd + ' s';
    var on = $('#op-next'); if (on) on.textContent = cd + ' s';
    var lt = $('#lv-tip'); if (lt) lt.textContent = f0(S.tip);
  }
  function loop() { tick(); requestAnimationFrame(loop); }

  /* ---------- boot ---------- */
  aimChips();
  var start = qs.get('screen') || 'node';
  show(start === 'search' ? 'node' : start, qs.get('snap'));
  if (start === 'search') { show('search'); }
  tick();
  if (qs.get('landing') === '1') {
    var t = performance.now(), at = parseFloat(qs.get('at') || '650');
    S.tip += 1; globe.play({ kind: 'block', producer: D.landing.producer, payees: D.landing.payees }, t - at); globe.freezeAt(t);
    $('#tip').textContent = f0(S.tip);
  }
  if (qs.get('toast') === '1') toast();
  if (!freeze) requestAnimationFrame(loop);
  window.atlasPhone = { show: show, toast: toast, globe: globe };
})();
