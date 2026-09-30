/* Flux Atlas design mock: Canvas2D globe.
   This is the reference implementation of the art-direction contract (design-direction.md section 7), not the
   production renderer. It reads every colour from the --globe-* tokens and draws: dot-matrix planet with a real
   day and night terminator, tier-coloured nodes, co-location stacks (towers), mesh arcs, pre-aimed payee
   reticles, the block landing (producer flare, shockwave that lights nodes as it passes, beams to payees,
   amount chips), selection beacon, weather haze, and an ambient camera. Orthographic projection, north up. */
(function () {
  'use strict';
  var TAU = Math.PI * 2, DEG = Math.PI / 180;

  function tok(name, fb) { var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; }
  function hex(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')'; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function vec(lat, lon) { var p = lat * DEG, l = lon * DEG, c = Math.cos(p); return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)]; }

  function makeSprite(size, draw) { var c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size); return c; }
  function radialSprite(rgb, stops, size) {
    return makeSprite(size || 64, function (g, s) {
      var r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      stops.forEach(function (st) { r.addColorStop(st[0], rgba(rgb, st[1])); });
      g.fillStyle = r; g.fillRect(0, 0, s, s);
    });
  }

  function AtlasGlobe(canvas, D, opts) {
    opts = opts || {};
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.D = D;
    this.dpr = Math.min(window.devicePixelRatio || 1, opts.dprCap || 2);
    this.pose = { lat: 34, lon: -12, size: 74, roll: -14 };
    this.inset = { left: 0, right: 0, top: 0, bottom: 0 };
    this.insetT = null; this.fly = null;
    this.layers = { land: true, graticule: true, nodes: true, towers: true, mesh: 'selection', aim: true, weather: false, labels: true, arcs: true };
    this.mode = 'live';
    this.sel = -1; this.hover = -1; this.aim = []; this.aimEta = 0; this.fx = []; this.chips = [];
    this.drift = 0; this.idleSince = 0; this.paused = !!opts.paused;
    this.clockBase = D.clock.demoNow; this.t0 = performance.now(); this.simT = 0;
    this.sizeMode = opts.sizeMode || 'height'; /* 'height' = percent of viewport height, 'min' = percent of free-area min side */
    this.stats = { fps: 0, frameMs: 0, drawn: 0 };
    this.listeners = {};
    this.readTokens();
    this.buildSprites();
    if (this.moonInit) this.moonInit(opts);
    this.buildLand();
    this.buildNodes();
    this.resize();
    var self = this;
    window.addEventListener('resize', function () { self.resize(); });
    this.bindPointer();
    this._loop = function (now) { self.frame(now); requestAnimationFrame(self._loop); };
    requestAnimationFrame(this._loop);
  }

  var P = AtlasGlobe.prototype;

  P.on = function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); };
  P.emit = function (ev, a) { (this.listeners[ev] || []).forEach(function (f) { f(a); }); };

  P.readTokens = function () {
    var t = {}, g = function (n, fb) { return tok('--globe-' + n, fb); };
    t.space = hex(g('space', '#000000')); t.ocean = hex(g('ocean', '#000214')); t.oceanLit = hex(g('ocean-lit', '#021546'));
    t.land = hex(g('land', '#4f7ad4')); t.landNight = hex(g('land-night', '#1b44a3'));
    t.landA = [parseFloat(g('land-alpha-day', '0.78')), parseFloat(g('land-alpha-night', '0.46'))];
    t.grat = hex(g('graticule', '#86a1da')); t.gratA = parseFloat(g('graticule-alpha', '0.055'));
    t.atmo = hex(g('atmosphere', '#4f7ad4')); t.atmoA = parseFloat(g('atmosphere-alpha', '0.6')); t.atmoW = parseFloat(g('atmosphere-width', '0.05'));
    t.rimHot = hex(g('rim-hot', '#ffffff')); t.termW = parseFloat(g('terminator-width', '0.22'));
    t.star = hex(g('star', '#cedaf0'));
    t.tier = [hex(g('cumulus', '#36d3ff')), hex(g('nimbus', '#c77dff')), hex(g('stratus', '#ffc857'))];
    t.size = [parseFloat(g('size-cumulus', '1')), parseFloat(g('size-nimbus', '1.35')), parseFloat(g('size-stratus', '1.75'))];
    t.haloA = parseFloat(g('halo-alpha', '0.32'));
    t.select = hex(g('select', '#ffffff')); t.mesh = hex(g('mesh', '#86a1da')); t.meshA = parseFloat(g('mesh-alpha', '0.22'));
    t.shock = hex(g('shock', '#4f7ad4')); t.shockHot = hex(g('shock-hot', '#ffffff')); t.beamHead = hex(g('beam-head', '#ffffff'));
    t.label = hex(g('label', '#d5d7db')); t.labelDim = hex(g('label-dim', '#a1a5ab'));
    t.risk = hex(g('risk', '#ff9a3d')); t.wxU = hex(g('weather-unsettled', '#ff9a3d')); t.wxS = hex(g('weather-storm', '#ff5470')); t.wxA = parseFloat(g('weather-alpha', '0.22'));
    t.aim = hex(g('aim', '#ffffff')); t.aimA = parseFloat(g('aim-alpha', '0.85'));
    t.dimA = parseFloat(g('dim-alpha', '0.14'));
    t.mine = hex(g('mine', '#86a1da')); t.app = hex(g('app', '#ffffff'));
    t.fontMono = tok('--font-mono', 'monospace'); t.fontSans = tok('--font-sans', 'sans-serif');
    this.tk = t;
  };

  P.buildSprites = function () {
    var t = this.tk;
    this.halo = t.tier.map(function (c) { return radialSprite(c, [[0, 1], [0.12, 0.6], [0.35, 0.16], [0.7, 0.03], [1, 0]], 64); });
    this.core = t.tier.map(function (c) { return radialSprite(mix(c, [255, 255, 255], 0.35), [[0, 1], [0.3, 0.95], [0.55, 0.45], [1, 0]], 32); });
    this.hotHalo = radialSprite(t.rimHot, [[0, 1], [0.15, 0.6], [0.4, 0.14], [1, 0]], 64);
    this.hotCore = radialSprite([255, 255, 255], [[0, 1], [0.4, 0.9], [0.7, 0.3], [1, 0]], 32);
    this.blueHalo = radialSprite(t.shock, [[0, 0.8], [0.3, 0.3], [1, 0]], 64);
    this.smoke = radialSprite([255, 255, 255], [[0, 0.9], [0.4, 0.4], [1, 0]], 128);
    this.smokeU = radialSprite(t.wxU, [[0, 0.95], [0.35, 0.45], [1, 0]], 128); this.smokeS = radialSprite(t.wxS, [[0, 0.95], [0.35, 0.45], [1, 0]], 128);
  };

  /* latitude-row lattice filtered by the land mask: the dot-matrix planet. Two densities (overview, zoomed). */
P.buildLand = function () {
    var L = window.ATLAS_LAND;
    function lattice(dLat, cr) {
      var xs = [], ys = [], zs = [], cs = [], rows = Math.round(180 / dLat);
      for (var r = 0; r <= rows; r++) {
        var lat = -90 + r * dLat; if (lat > 88.5 || lat < -88.5) continue;
        var c = Math.cos(lat * DEG), n = Math.max(1, Math.round(360 * c / dLat)), off = (r % 2) * 0.5;
        for (var k = 0; k < n; k++) {
          var lon = -180 + (k + off) * 360 / n, cv = L.cover(lat, lon, cr);
          if (cv >= 0.34) { var v = vec(lat, lon); xs.push(v[0]); ys.push(v[1]); zs.push(v[2]); cs.push(cv); }
        }
      }
      return { x: new Float32Array(xs), y: new Float32Array(ys), z: new Float32Array(zs), c: new Float32Array(cs), n: xs.length };
    }
    this.lod = [lattice(0.78, 0.3), lattice(0.3, 0.12)];
    var mx = Math.max(this.lod[0].n, this.lod[1].n);
    this.bins = []; for (var b = 0; b < 10; b++) this.bins.push(new Float32Array(mx * 4));
    this.binN = new Int32Array(10);
    this.ln = this.lod[0].n;
  };

    P.buildNodes = function () {
    var n = this.D.nodes, N = n.n;
    this.nx = new Float32Array(N); this.ny = new Float32Array(N); this.nz = new Float32Array(N);
    for (var i = 0; i < N; i++) { var v = vec(n.lat[i], n.lon[i]); this.nx[i] = v[0]; this.ny[i] = v[1]; this.nz[i] = v[2]; }
    /* sites: towers for n >= 4, loose nodes otherwise */
    var sites = this.D.sites, big = [], small = [];
    sites.forEach(function (s, si) { s.v = vec(s.lat, s.lon); s.i = si; });
    this.siteOf = n.site;
    var bySite = {}; for (var k = 0; k < N; k++) { (bySite[n.site[k]] = bySite[n.site[k]] || []).push(k); }
    this.siteNodes = bySite;
    sites.forEach(function (s) { if (s.n >= 4) big.push(s); });
    big.sort(function (a, b) { return b.n - a.n; });
    this.bigSites = big;
    var loose = []; for (var m = 0; m < N; m++) { if (sites[n.site[m]].n < 4) loose.push(m); }
    this.loose = loose;
    /* stars */
    this.stars = [];
    var r = this.D.rng;
    for (var q = 0; q < 1100; q++) this.stars.push([r(), r(), 0.5 + r() * 1.0, 0.12 + r() * 0.55]);
    /* labels: top hubs by node count */
    var hubCount = {}; sites.forEach(function (s) { hubCount[s.hub] = (hubCount[s.hub] || 0) + s.n; });
    this.labelHubs = Object.keys(hubCount).map(function (k) { return { hub: +k, n: hubCount[k] }; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 22);
  };

  P.resize = function () {
    var w = window.innerWidth, h = window.innerHeight;
    this.W = w; this.H = h; this.dpr = Math.min(window.devicePixelRatio || 1, this.dpr || 2);
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.starsCanvas = makeSprite(1, function () { });
    var sc = document.createElement('canvas'); sc.width = this.canvas.width; sc.height = this.canvas.height; var g = sc.getContext('2d');
    var t = this.tk, d = this.dpr;
    this.stars.forEach(function (s) { g.fillStyle = rgba(t.star, s[3]); var sz = s[2] * d; g.fillRect(s[0] * sc.width, s[1] * sc.height, sz, sz); });
    this.starsCanvas = sc;
  };

  /* ---------- camera ---------- */
  P.setInset = function (i, ms) { this.insetT = { from: Object.assign({}, this.inset), to: Object.assign({ left: 0, right: 0, top: 0, bottom: 0 }, i), t0: performance.now(), ms: ms == null ? 300 : ms }; if (!ms && ms === 0) { this.inset = Object.assign({}, this.insetT.to); this.insetT = null; } };
  P.setPose = function (p) { Object.assign(this.pose, p); };
  P.flyTo = function (target, ms) {
    var p = this.pose, toLon = target.lon == null ? p.lon : target.lon;
    var dl = ((toLon - p.lon + 540) % 360) - 180;
    var ang = Math.acos(clamp(vec(p.lat, p.lon).reduce(function (s, v, i) { return s + v * vec(target.lat == null ? p.lat : target.lat, toLon)[i]; }, 0), -1, 1)) / DEG;
    this.fly = { from: { lat: p.lat, lon: p.lon, size: p.size }, to: { lat: target.lat == null ? p.lat : target.lat, lon: p.lon + dl, size: target.size || p.size }, t0: performance.now(), ms: ms || (900 + 1700 * Math.min(1, ang / 120)), arc: Math.min(0.18, ang / 700) };
  };
  P.select = function (idx) { this.sel = idx; this.selT = performance.now(); };
  P.setAim = function (list, etaMs) { this.aim = list || []; this.aimT = performance.now(); this.aimEta = etaMs; this.aimAt = performance.now() + (etaMs || 0); };
  P.setLayers = function (l) { Object.assign(this.layers, l); };
  P.setMode = function (m) { this.mode = m; };
  /* boot reveal: the world lights up from a point as a wave (angular radius th, radians). null disables. */
  P.setReveal = function (idxOrNull, th) { if (idxOrNull == null) { this.rv = null; return; } this.rv = { v: [this.nx[idxOrNull], this.ny[idxOrNull], this.nz[idxOrNull]], th: th }; };
  /* constellation: a set of node indices drawn hot while the rest of the planet dims (app instances, operator fleet) */
  P.setConstellation = function (list, kind) {
    if (!list || !list.length) { this.constel = null; this.focusSet = null; return; }
    var set = {}; list.forEach(function (i) { set[i] = true; });
    this.constel = { list: list, kind: kind || 'app', t: performance.now() }; this.focusSet = set;
  };

  P.geom = function () {
    var ins = this.inset, W = this.W, H = this.H;
    var fw = W - ins.left - ins.right, fh = H - ins.top - ins.bottom;
    this.cx = ins.left + fw / 2; this.cy = ins.top + fh / 2;
    var dia = this.sizeMode === 'min' ? Math.min(fw, fh) * this.pose.size / 100 : H * this.pose.size / 100;
    this.R = dia / 2;
    var p = this.pose, phi = p.lat * DEG, lam = p.lon * DEG;
    this.c = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
    this.e = [-Math.sin(lam), Math.cos(lam), 0];
    this.nn = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)];
    this.cr = Math.cos(p.roll * DEG); this.sr = Math.sin(p.roll * DEG);
    /* sun */
    var now = this.clockBase + this.simT, dd = new Date(now * 1000);
    var hrs = dd.getUTCHours() + dd.getUTCMinutes() / 60 + dd.getUTCSeconds() / 3600;
    var doy = Math.floor((Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate()) - Date.UTC(dd.getUTCFullYear(), 0, 0)) / 86400000);
    var decl = -23.44 * Math.cos(TAU * (doy + 10) / 365) * DEG, slon = -15 * (hrs - 12) * DEG;
    this.sun = [Math.cos(decl) * Math.cos(slon), Math.cos(decl) * Math.sin(slon), Math.sin(decl)];
    var sx = this.dot3(this.sun, this.e), sy = this.dot3(this.sun, this.nn), sz = this.dot3(this.sun, this.c);
    this.sunS = { x: sx * this.cr - sy * this.sr, y: sx * this.sr + sy * this.cr, z: sz };
  };
  P.dot3 = function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };

  /* project a unit vector (x,y,z) at radius r; returns [sx, sy, depth, visible] */
  var _o = [0, 0, 0, 0];
  P.proj = function (x, y, z, r, o) {
    o = o || _o; r = r || 1;
    var e = this.e, n = this.nn, c = this.c;
    var X = (x * e[0] + y * e[1] + z * e[2]) * r, Y = (x * n[0] + y * n[1] + z * n[2]) * r, Z = (x * c[0] + y * c[1] + z * c[2]) * r;
    var xr = X * this.cr - Y * this.sr, yr = X * this.sr + Y * this.cr;
    o[0] = this.cx + this.R * xr; o[1] = this.cy - this.R * yr; o[2] = Z;
    o[3] = (Z > 0 || (X * X + Y * Y) > 1.0) ? 1 : 0;
    return o;
  };
  P.project = function (lat, lon, alt) { var v = vec(lat, lon), o = this.proj(v[0], v[1], v[2], 1 + (alt || 0), [0, 0, 0, 0]); return { x: o[0], y: o[1], z: o[2], visible: !!o[3] }; };
  /* billboard lift: towers, pillars and flares stand up on screen (2.5D skyline) so stacks stay legible at the disc centre,
     and lean radially toward the limb where the real projection would put them. h is a fraction of the globe radius. */
  P.lift = function (o, h, out) {
    var ux = (o[0] - this.cx) / this.R, uy = (o[1] - this.cy) / this.R, m = Math.min(1, Math.hypot(ux, uy));
    var dx = ux * 0.75, dy = uy * 0.75 - (1 - m) * 0.9 - 0.25, l = Math.hypot(dx, dy) || 1; out = out || [0, 0];
    out[0] = o[0] + dx / l * h * this.R; out[1] = o[1] + dy / l * h * this.R; return out;
  };
  P.zoomBand = function () { var s = this.pose.size; return s < 110 ? 0 : (s < 260 ? 1 : (s < 700 ? 2 : 3)); };

  /* ---------- frame ---------- */
  P.freezeAt = function (t) { this.freezeNow = t; this.paused = true; };
  P.unfreeze = function () { this.freezeNow = null; this.paused = false; };
  P.frame = function (now) {
    var t0 = performance.now();
    if (this.freezeNow != null) now = this.freezeNow;
    if (!this.lastNow) this.lastNow = now;
    var dt = Math.min(0.05, (now - this.lastNow) / 1000); this.lastNow = now;
    if (!this.paused) this.simT += dt;
    this.update(now, dt);
    this.draw(now, dt);
    var ft = performance.now() - t0; this.stats.frameMs = this.stats.frameMs * 0.9 + ft * 0.1; this.stats.fps = this.stats.fps * 0.9 + (dt > 0 ? 1 / dt : 60) * 0.1;
  };

  P.update = function (now, dt) {
    if (this.insetT) { var k = this.insetT, u = clamp((now - k.t0) / k.ms, 0, 1), e = easeInOut(u), f = k.from, to = k.to; this.inset = { left: f.left + (to.left - f.left) * e, right: f.right + (to.right - f.right) * e, top: f.top + (to.top - f.top) * e, bottom: f.bottom + (to.bottom - f.bottom) * e }; if (u >= 1) this.insetT = null; }
    if (this.fly) { var fl = this.fly, uu = clamp((now - fl.t0) / fl.ms, 0, 1), ee = easeInOut(uu); this.pose.lat = fl.from.lat + (fl.to.lat - fl.from.lat) * ee; this.pose.lon = fl.from.lon + (fl.to.lon - fl.from.lon) * ee; this.pose.size = fl.from.size + (fl.to.size - fl.from.size) * ee - 100 * fl.arc * Math.sin(Math.PI * ee) * 0; if (uu >= 1) this.fly = null; }
    else if (this.vel && (Math.abs(this.vel.x) > 0.001 || Math.abs(this.vel.y) > 0.001)) { this.pose.lon -= this.vel.x; this.pose.lat = clamp(this.pose.lat + this.vel.y, -80, 80); this.vel.x *= 0.92; this.vel.y *= 0.92; }
    else if (this.mode === 'ambient' || (this.driftOn && now - this.idleSince > 20000)) { this.pose.lon += (this.mode === 'ambient' ? 2.2 : 1.2) * dt; if (this.mode === 'ambient') this.pose.lat = 26 + 6 * Math.sin(this.simT * 0.05); }
    if (this.moonUpdate) this.moonUpdate(now, dt);
  };

  P.draw = function (now, dt) {
    var g = this.ctx, d = this.dpr, tk = this.tk;
    this.geom();
    g.setTransform(d, 0, 0, d, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.clearRect(0, 0, this.W, this.H);
    /* stars */
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(this.starsCanvas, 0, 0); g.restore();
    var cx = this.cx, cy = this.cy, R = this.R, band = this.zoomBand();
    var focusDim = this.focusSet ? true : false;

    /* outer bloom */
    var bl = g.createRadialGradient(cx, cy, 0, cx, cy, R * 2.0);
    bl.addColorStop(0, rgba(tk.atmo, 0.13)); bl.addColorStop(0.5, rgba(tk.atmo, 0.13)); bl.addColorStop(0.68, rgba(tk.atmo, 0.045)); bl.addColorStop(1, rgba(tk.atmo, 0));
    g.fillStyle = bl; g.beginPath(); g.arc(cx, cy, R * 2.0, 0, TAU); g.fill();

    /* sphere body, lit toward the sun */
    var ss = this.sunS, lx = cx + R * 0.45 * ss.x, ly = cy - R * 0.45 * ss.y;
    var body = g.createRadialGradient(lx, ly, R * 0.05, cx, cy, R * 1.05);
    body.addColorStop(0, rgba(mix(tk.ocean, tk.oceanLit, 1), 1)); body.addColorStop(0.6, rgba(mix(tk.ocean, tk.oceanLit, 0.4), 1)); body.addColorStop(1, rgba(tk.ocean, 1));
    g.fillStyle = body; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
    /* limb darkening + fresnel */
    var vg = g.createRadialGradient(cx, cy, R * 0.62, cx, cy, R);
    vg.addColorStop(0, 'rgba(0,2,10,0)'); vg.addColorStop(1, 'rgba(0,2,10,0.42)');
    g.fillStyle = vg; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();

    /* graticule */
    if (this.layers.graticule) this.drawGraticule(g, band);

    /* land dots */
    if (this.layers.land) this.drawLand(g, band);

    /* weather */
    if (this.layers.weather) this.drawWeather(g);

    /* mesh */
    this.drawMesh(g, now);

    /* sites: glow + towers, loose nodes */
    if (this.layers.nodes) this.drawNodes(g, now, band);

    /* events */
    this.drawFx(g, now);

    /* constellation */
    if (this.constel) this.drawConstel(g, now);

    /* aim reticles */
    if (this.layers.aim) this.drawAim(g, now);

    /* selection beacon */
    if (this.sel >= 0) this.drawBeacon(g, now);

    /* atmosphere on top */
    this.drawAtmosphere(g);

    /* labels */
    if (this.layers.labels) this.drawLabels(g, band);

    /* the moon: the chain, always in front */
    if (this.drawMoon) this.drawMoon(g, now);
  };

  P.drawGraticule = function (g, band) {
    var tk = this.tk, step = band >= 2 ? 10 : 30;
    g.lineWidth = 1; g.strokeStyle = rgba(tk.grat, tk.gratA); g.beginPath();
    var o = [0, 0, 0, 0], any;
    for (var lat = -60; lat <= 60; lat += step) { any = false; for (var lon = -180; lon <= 181; lon += 4) { var v = vec(lat, lon); this.proj(v[0], v[1], v[2], 1, o); if (o[2] > 0) { if (!any) { g.moveTo(o[0], o[1]); any = true; } else g.lineTo(o[0], o[1]); } else any = false; } }
    for (var lon2 = -180; lon2 < 180; lon2 += step) { any = false; for (var lat2 = -88; lat2 <= 88; lat2 += 4) { var w = vec(lat2, lon2); this.proj(w[0], w[1], w[2], 1, o); if (o[2] > 0) { if (!any) { g.moveTo(o[0], o[1]); any = true; } else g.lineTo(o[0], o[1]); } else any = false; } }
    g.stroke();
  };

P.drawLand = function (g, band) {
    var tk = this.tk, R = this.R, e = this.e, n = this.nn, c = this.c, cr = this.cr, sr = this.sr, cx = this.cx, cy = this.cy, s = this.sun;
    var NB = 10, bins = this.bins, cnt = this.binN; for (var b = 0; b < NB; b++) cnt[b] = 0;
    var tw = tk.termW, L = this.lod[R > 640 ? 1 : 0], lx = L.x, ly = L.y, lz = L.z, lc = L.c, W = this.W, H = this.H, rv = this.rv;
    for (var i = 0; i < L.n; i++) {
      var x = lx[i], y = ly[i], z = lz[i];
      var Z = x * c[0] + y * c[1] + z * c[2]; if (Z <= 0.02) continue;
      var X = x * e[0] + y * e[1] + z * e[2], Y = x * n[0] + y * n[1] + z * n[2];
      var sx = cx + R * (X * cr - Y * sr), sy = cy - R * (X * sr + Y * cr);
      if (sx < -8 || sx > W + 8 || sy < -8 || sy > H + 8) continue;
      if (rv && x * rv.v[0] + y * rv.v[1] + z * rv.v[2] < Math.cos(rv.th)) continue;
      var day = x * s[0] + y * s[1] + z * s[2];
      var tday = smooth(-tw, tw, day);
      var bi = Math.min(NB - 1, (tday * NB) | 0), k = cnt[bi]++ * 4;
      bins[bi][k] = sx; bins[bi][k + 1] = sy; bins[bi][k + 2] = Z; bins[bi][k + 3] = lc[i];
    }
    var dotR = Math.max(0.62, (R > 640 ? 0.00145 : 0.0036) * R), fade = 1 - smooth(1500, 3200, R);
    if (fade <= 0.01) return;
    for (var bb = 0; bb < NB; bb++) {
      var tt = (bb + 0.5) / NB, col = mix(tk.landNight, tk.land, tt), a = (tk.landA[1] + (tk.landA[0] - tk.landA[1]) * tt) * fade;
      g.fillStyle = rgba(col, a); g.beginPath();
      var arr = bins[bb], m = cnt[bb] * 4;
      if (dotR < 1.0) { for (var j = 0; j < m; j += 4) { var sz = dotR * 2 * (0.5 + 0.5 * Math.sqrt(arr[j + 2])) * (0.62 + 0.38 * arr[j + 3]); g.rect(arr[j] - sz / 2, arr[j + 1] - sz / 2, sz, sz); } }
      else { for (var j2 = 0; j2 < m; j2 += 4) { var rr = dotR * (0.45 + 0.55 * Math.sqrt(arr[j2 + 2])) * (0.62 + 0.38 * arr[j2 + 3]); g.moveTo(arr[j2] + rr, arr[j2 + 1]); g.arc(arr[j2], arr[j2 + 1], rr, 0, TAU); } }
      g.fill();
    }
  };

    P.drawWeather = function (g) {
    var n = this.D.nodes, tk = this.tk, R = this.R, o = [0, 0, 0, 0], t = this.simT;
    g.globalCompositeOperation = 'source-over'; /* normal blend keeps the haze red over a blue planet; additive turned it magenta */
    for (var i = 0; i < n.n; i++) {
      var f = n.flags[i]; if (!(f & 8) && !(f & 4)) continue;
      this.proj(this.nx[i], this.ny[i], this.nz[i], 1, o); if (o[2] < 0.05) continue;
      var storm = (f & 8) ? 1 : 0.5, rad = Math.min(40, R * (0.042 + 0.012 * Math.sin(t * 0.3 + i))), col = storm > 0.9 ? tk.wxS : tk.wxU;
      g.globalAlpha = Math.min(1, tk.wxA * 1.15 * (0.6 + 0.4 * Math.sqrt(o[2]))); g.drawImage(storm > 0.9 ? this.smokeS : this.smokeU, o[0] - rad, o[1] - rad, rad * 2, rad * 2);
      g.globalAlpha = 1;
      g.fillStyle = rgba(col, 0.75); g.beginPath(); g.arc(o[0], o[1], 2.4, 0, TAU); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  };

  P.siteColor = function (s) { var t = this.tk.tier, n = s.n; return [(s.t[0] * t[0][0] + s.t[1] * t[1][0] + s.t[2] * t[2][0]) / n, (s.t[0] * t[0][1] + s.t[1] * t[1][1] + s.t[2] * t[2][1]) / n, (s.t[0] * t[0][2] + s.t[1] * t[1][2] + s.t[2] * t[2][2]) / n]; };

  P.nodeBoost = function (i, now) {
    /* shockwave lighting: +35% as the front passes */
    var b = 0, fx = this.fx;
    for (var k = 0; k < fx.length; k++) {
      var f = fx[k]; if (f.kind !== 'shock') continue;
      var u = (now - f.t0) / f.dur; if (u < 0 || u > 1) continue;
      var th = f.reach * DEG * easeOutCubic(u), dd = Math.acos(clamp(this.nx[i] * f.v[0] + this.ny[i] * f.v[1] + this.nz[i] * f.v[2], -1, 1));
      var w = 0.085; var q = (dd - th) / w; b += 0.55 * Math.exp(-q * q) * (1 - u * 0.6);
    }
    return b;
  };

  P.drawNodes = function (g, now, band) {
    var D = this.D, n = D.nodes, tk = this.tk, R = this.R, o = [0, 0, 0, 0], sites = D.sites;
    g.globalCompositeOperation = 'lighter';
    var zs = band === 0 ? 1 : (band === 1 ? 1.25 : (band === 2 ? 1.6 : 2.4));
    var base = Math.max(0.9, R * 0.0036) * zs; base = Math.min(base, 3.4);
    var dimA = this.focusSet ? tk.dimA : 1;
    var hasShock = this.fx.some(function (f) { return f.kind === 'shock'; });
    /* site glows and towers */
    var bigs = this.bigSites, towers = this.layers.towers;
    for (var bi = 0; bi < bigs.length; bi++) {
      var s = bigs[bi]; this.proj(s.v[0], s.v[1], s.v[2], 1, o); if (o[2] < 0.04) continue;
      if (this.rv && s.v[0] * this.rv.v[0] + s.v[1] * this.rv.v[1] + s.v[2] * this.rv.v[2] < Math.cos(this.rv.th)) continue;
      var vis = smooth(0.0, 0.25, o[2]), col = this.siteColor(s), logn = Math.log(s.n + 1);
      var gr = Math.min(34, R * (0.0055 + 0.0036 * logn) * (band >= 2 ? 0.6 : 1));
      g.globalAlpha = Math.min(0.30, 0.09 + 0.03 * logn) * vis * dimA;
      g.drawImage(this.siteSprite(col), o[0] - gr, o[1] - gr, gr * 2, gr * 2);
      if (towers && band <= 2) {
        var h = Math.min(0.15, 0.0062 * Math.pow(s.n, 0.62)) * (band === 2 ? 0.55 : 1), top = this.lift(o, h, [0, 0]);
        if (true) {
          var w = band >= 2 ? 2.4 : Math.max(1.3, R * 0.0034);
          /* segments bottom to top: stratus, nimbus, cumulus */
          var order = [2, 1, 0], acc = 0, bx = o[0], by = o[1], dx = top[0] - o[0], dy = top[1] - o[1], dom = 0, domF = 0;
          g.lineCap = 'butt';
          for (var q = 0; q < 3; q++) {
            var tr = order[q], frac = s.t[tr] / s.n; if (frac <= 0) continue;
            if (frac > domF) { domF = frac; dom = tr; }
            var a0 = acc, a1 = acc + frac; acc = a1;
            g.strokeStyle = rgba(tk.tier[tr], 0.88 * vis * dimA); g.lineWidth = w;
            g.beginPath(); g.moveTo(bx + dx * a0 + dx * 0.01, by + dy * a0 + dy * 0.01); g.lineTo(bx + dx * a1 - dx * 0.01, by + dy * a1 - dy * 0.01); g.stroke();
          }
          var cr = Math.min(3.2, Math.max(1.6, R * 0.0042));
          g.globalAlpha = 0.55 * vis * dimA; g.drawImage(this.halo[dom], top[0] - cr * 3.4, top[1] - cr * 3.4, cr * 6.8, cr * 6.8);
          g.globalAlpha = 0.95 * vis * dimA; g.drawImage(this.core[dom], top[0] - cr * 1.1, top[1] - cr * 1.1, cr * 2.2, cr * 2.2);
        }
      }
    }
    /* loose nodes */
    var loose = this.loose;
    for (var li = 0; li < loose.length; li++) {
      var i = loose[li]; this.proj(this.nx[i], this.ny[i], this.nz[i], 1, o); if (o[2] < 0.04) continue;
      if (this.rv && this.nx[i] * this.rv.v[0] + this.ny[i] * this.rv.v[1] + this.nz[i] * this.rv.v[2] < Math.cos(this.rv.th)) continue;
      var vis2 = smooth(0.0, 0.22, o[2]), tier = n.tier[i], f = n.flags[i];
      var r = Math.min(4.6, base * tk.size[tier] * (0.6 + 0.4 * o[2]));
      var boost = hasShock ? this.nodeBoost(i, now) : 0;
      var dim = 1; if (this.focusSet && !this.focusSet[i]) dim = tk.dimA;
      var a = (band === 0 ? 0.6 : 0.85) * vis2 * dim * (0.82 + 0.18 * Math.sin(now / 1700 + i * 1.731));
      if (f & 8) { a *= 0.55; }
      if (f & 2) { /* new in 24h: hot ring */
        g.strokeStyle = rgba(tk.select, 0.5 * vis2); g.lineWidth = 1; g.beginPath(); g.arc(o[0], o[1], r * 2.6 + 0.6 * Math.sin(now / 600 + i), 0, TAU); g.stroke();
      }
      g.globalAlpha = Math.min(1, (a + boost * 0.6));
      var hr = r * (3.4 + boost * 2.2);
      g.drawImage(this.halo[tier], o[0] - hr, o[1] - hr, hr * 2, hr * 2);
      g.globalAlpha = Math.min(1, (a + 0.3 + boost) * 1.0);
      g.drawImage(this.core[tier], o[0] - r * 1.15, o[1] - r * 1.15, r * 2.3, r * 2.3);
      if (band >= 2 && tier > 0) { g.globalAlpha = 0.5 * vis2 * dim; g.strokeStyle = rgba(tk.tier[tier], 1); g.lineWidth = 1; g.beginPath(); g.arc(o[0], o[1], r * 1.9, 0, TAU); g.stroke(); if (tier === 2) { g.globalAlpha = 0.28 * vis2 * dim; g.beginPath(); g.arc(o[0], o[1], r * 2.7, 0, TAU); g.stroke(); } }
      if (f & 4 && (this.layers.weather || i === this.sel)) { g.globalAlpha = 0.8 * vis2; g.strokeStyle = rgba(tk.risk, 1); g.lineWidth = 1.4; g.beginPath(); g.arc(o[0], o[1], r * 3.2 * (1 + 0.1 * Math.sin(now / 250 + i)), 0, TAU); g.stroke(); }
    }
    /* shock lift for big sites: a flash glow when the front crosses */
    if (hasShock) {
      for (var b2 = 0; b2 < bigs.length; b2++) {
        var ss = bigs[b2]; this.proj(ss.v[0], ss.v[1], ss.v[2], 1, o); if (o[2] < 0.04) continue;
        var bst = 0; for (var kk = 0; kk < this.fx.length; kk++) { var f2 = this.fx[kk]; if (f2.kind !== 'shock') continue; var u2 = (now - f2.t0) / f2.dur; if (u2 < 0 || u2 > 1) continue; var th2 = f2.reach * DEG * easeOutCubic(u2), dd2 = Math.acos(clamp(ss.v[0] * f2.v[0] + ss.v[1] * f2.v[1] + ss.v[2] * f2.v[2], -1, 1)); var q2 = (dd2 - th2) / 0.09; bst += Math.exp(-q2 * q2) * (1 - u2 * 0.6); }
        if (bst > 0.02) { var rr = Math.min(34, R * (0.022 + 0.006 * Math.log(ss.n))); g.globalAlpha = Math.min(0.5, bst * 0.42); g.drawImage(this.hotHalo, o[0] - rr * 1.6, o[1] - rr * 1.6, rr * 3.2, rr * 3.2); }
      }
    }
    if (this.hover >= 0 && this.hover !== this.sel) { var ho = this.proj(this.nx[this.hover], this.ny[this.hover], this.nz[this.hover], 1, [0, 0, 0, 0]); if (ho[3]) { g.globalAlpha = 0.9; g.strokeStyle = rgba(tk.select, 0.9); g.lineWidth = 1.2; g.beginPath(); g.arc(ho[0], ho[1], 7.5, 0, TAU); g.stroke(); } }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  };

  var _siteSprites = {};
  P.siteSprite = function (col) {
    var k = (col[0] >> 4) + ',' + (col[1] >> 4) + ',' + (col[2] >> 4);
    if (!_siteSprites[k]) _siteSprites[k] = radialSprite(col, [[0, 0.95], [0.18, 0.5], [0.5, 0.12], [1, 0]], 64);
    return _siteSprites[k];
  };

  /* great-circle arc samples (screen space) between two unit vectors, lifted by altMax */
  P.arcPts = function (a, b, altMax, segs, out) {
    var dotp = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1), om = Math.acos(dotp), so = Math.sin(om) || 1e-6, o = [0, 0, 0, 0];
    out.length = 0;
    for (var i = 0; i <= segs; i++) {
      var t = i / segs, k1 = Math.sin((1 - t) * om) / so, k2 = Math.sin(t * om) / so;
      var x = a[0] * k1 + b[0] * k2, y = a[1] * k1 + b[1] * k2, z = a[2] * k1 + b[2] * k2;
      var r = 1 + altMax * Math.pow(Math.sin(Math.PI * t), 0.85);
      this.proj(x, y, z, r, o); out.push([o[0], o[1], o[3], t]);
    }
    return om;
  };

  P.drawMesh = function (g, now) {
    var D = this.D, tk = this.tk, n = D.nodes, pts = [];
    if (this.layers.mesh === 'off') return;
    g.globalCompositeOperation = 'lighter';
    if (this.layers.mesh === 'flow') {
      /* faint network web between big sites, bundled through the region centre */
      var bigs = this.bigSites.slice(0, 60), seed = 7, o = [0, 0, 0, 0];
      g.lineWidth = 1;
      for (var i = 0; i < 160; i++) {
        seed = (seed * 16807) % 2147483647; var a = bigs[seed % bigs.length];
        seed = (seed * 16807) % 2147483647; var b = bigs[seed % bigs.length]; if (a === b) continue;
        var om = this.arcPts(a.v, b.v, 0.06 + 0.1 * (Math.acos(clamp(a.v[0] * b.v[0] + a.v[1] * b.v[1] + a.v[2] * b.v[2], -1, 1)) / Math.PI), 28, pts);
        g.strokeStyle = rgba(tk.mesh, 0.06); g.beginPath(); var mv = false;
        for (var k = 0; k < pts.length; k++) { if (pts[k][2]) { if (!mv) { g.moveTo(pts[k][0], pts[k][1]); mv = true; } else g.lineTo(pts[k][0], pts[k][1]); } else mv = false; }
        g.stroke();
        var ph = ((now / 4000) + i * 0.137) % 1, pi = Math.min(pts.length - 1, Math.floor(ph * (pts.length - 1)));
        if (pts[pi][2]) { g.globalAlpha = 0.7; g.drawImage(this.hotHalo, pts[pi][0] - 4, pts[pi][1] - 4, 8, 8); g.globalAlpha = 1; }
      }
    } else if (this.sel >= 0 && this.D.peers) {
      var sv = [this.nx[this.sel], this.ny[this.sel], this.nz[this.sel]];
      var selA = this.selT ? easeOutCubic(clamp((performance.now() - this.selT - 350) / 900, 0, 1)) : 1;
      var peers = this.D.peers;
      for (var p = 0; p < peers.length; p++) {
        var pr = peers[p], pv = vec(pr.lat, pr.lon), dist = Math.acos(clamp(sv[0] * pv[0] + sv[1] * pv[1] + sv[2] * pv[2], -1, 1));
        if (dist < 0.002) continue;
        this.arcPts(sv, pv, 0.05 + 0.18 * (dist / Math.PI), 40, pts);
        var inbound = pr.dir === 'in';
        g.lineWidth = 1.2; g.strokeStyle = rgba(tk.mesh, tk.meshA * selA * (inbound ? 0.8 : 1.15));
        if (inbound) g.setLineDash([2, 4]);
        g.beginPath(); var mv2 = false;
        for (var q = 0; q < pts.length; q++) { if (pts[q][2]) { if (!mv2) { g.moveTo(pts[q][0], pts[q][1]); mv2 = true; } else g.lineTo(pts[q][0], pts[q][1]); } else mv2 = false; }
        g.stroke(); g.setLineDash([]);
        /* travelling packet */
        var ph2 = ((now / 4000) * (inbound ? -1 : 1) + p * 0.173) % 1; if (ph2 < 0) ph2 += 1;
        var pj = pts[Math.min(pts.length - 1, Math.floor(ph2 * (pts.length - 1)))];
        if (pj[2]) { g.globalAlpha = 0.85 * selA; g.drawImage(this.hotHalo, pj[0] - 3.5, pj[1] - 3.5, 7, 7); g.globalAlpha = 1; }
        /* peer end cap */
        var po = this.proj(pv[0], pv[1], pv[2], 1, [0, 0, 0, 0]);
        if (po[3] && po[2] > 0.05) { g.fillStyle = rgba(tk.mesh, 0.5 * selA); g.beginPath(); g.arc(po[0], po[1], 1.6, 0, TAU); g.fill(); }
      }
    }
    g.globalCompositeOperation = 'source-over';
  };

  P.drawAtmosphere = function (g) {
    var tk = this.tk, cx = this.cx, cy = this.cy, R = this.R, w = tk.atmoW;
    g.globalCompositeOperation = 'lighter';
    /* fresnel: inner edge glow (gradient starts at the centre so nothing leaks into the disc) */
    var inner = 1 - w * 2.6, fr = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    fr.addColorStop(0, rgba(tk.atmo, 0)); fr.addColorStop(inner, rgba(tk.atmo, 0)); fr.addColorStop(0.985, rgba(tk.atmo, tk.atmoA * 0.22)); fr.addColorStop(1, rgba(tk.atmo, tk.atmoA * 0.34));
    g.fillStyle = fr; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
    /* outside rim */
    var ro = R * (1 + w * 1.9), out = g.createRadialGradient(cx, cy, 0, cx, cy, ro), p0 = R * 0.997 / ro;
    out.addColorStop(0, rgba(tk.atmo, 0)); out.addColorStop(p0 * 0.999, rgba(tk.atmo, 0)); out.addColorStop(p0, rgba(tk.atmo, tk.atmoA * 0.6)); out.addColorStop(p0 + (1 - p0) * 0.22, rgba(tk.atmo, tk.atmoA * 0.22)); out.addColorStop(1, rgba(tk.atmo, 0));
    g.fillStyle = out; g.beginPath(); g.arc(cx, cy, ro, 0, TAU); g.fill();
    /* sun rim: hot specular arc on the limb facing the sun */
    var s = this.sunS, az = Math.atan2(-s.y, s.x), k = 0.3 + 0.7 * clamp(1 - s.z, 0, 1);
    var cg = g.createConicGradient(az - Math.PI * 0.42, cx, cy);
    var hot = tk.rimHot;
    cg.addColorStop(0, rgba(hot, 0)); cg.addColorStop(0.06, rgba(hot, 0.05 * k)); cg.addColorStop(0.11, rgba(hot, 0.5 * k)); cg.addColorStop(0.21, rgba(hot, 0.92 * k)); cg.addColorStop(0.31, rgba(hot, 0.5 * k)); cg.addColorStop(0.36, rgba(hot, 0.05 * k)); cg.addColorStop(0.42, rgba(hot, 0)); cg.addColorStop(1, rgba(hot, 0));
    g.strokeStyle = cg; g.lineWidth = Math.max(1.3, R * 0.0042); g.beginPath(); g.arc(cx, cy, R * 1.001, 0, TAU); g.stroke();
    g.lineWidth = Math.max(3, R * 0.011); g.globalAlpha = 0.28; g.beginPath(); g.arc(cx, cy, R * 1.003, 0, TAU); g.stroke(); g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  };

    /* ---------- events ---------- */
  P.play = function (e, t0) {
    var now = t0 != null ? t0 : performance.now(), D = this.D, n = D.nodes;
    if (e.kind === 'block' && this.moonPlay) { this.moonPlay(e, now); }
    else if (e.kind === 'block') {
      var pv = [this.nx[e.producer], this.ny[e.producer], this.nz[e.producer]];
      this.fx.push({ kind: 'flare', t0: now, dur: 900, node: e.producer });
      this.fx.push({ kind: 'shock', t0: now, dur: 1700, reach: 62, v: pv });
      var delays = [180, 300, 420], self = this;
      e.payees.forEach(function (p, i) {
        self.fx.push({ kind: 'beam', t0: now + delays[i], dur: 1100, a: e.producer, b: p.node, tier: p.tier, amount: p.amount });
        self.fx.push({ kind: 'pulse', t0: now + delays[i] + 1050, dur: 900, node: p.node, tier: p.tier });
        self.fx.push({ kind: 'chip', t0: now + delays[i] + 1050, dur: 2400, node: p.node, tier: p.tier, text: '+' + p.amount.toFixed(2) });
      });
      this.aim = []; this.aimClear = now + 1500;
      if (e.emission) this.fx.push({ kind: 'shock', t0: now + 400, dur: 2100, reach: 88, v: pv });
    } else if (e.kind === 'join') {
      this.fx.push({ kind: 'birth', t0: now, dur: 1200, node: e.node });
    } else if (e.kind === 'pulse') {
      this.fx.push({ kind: 'pulse', t0: now, dur: 1000, node: e.node, tier: n.tier[e.node] });
    }
  };


  /* a ring of angular radius th around unit vector c, drawn as four passes (glow to hot core) */
  P.drawRing = function (g, c, th, a) {
    var tk = this.tk, o = [0, 0, 0, 0], ref = Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    var t1 = [c[1] * ref[2] - c[2] * ref[1], c[2] * ref[0] - c[0] * ref[2], c[0] * ref[1] - c[1] * ref[0]], l1 = Math.hypot(t1[0], t1[1], t1[2]); t1 = [t1[0] / l1, t1[1] / l1, t1[2] / l1];
    var t2 = [c[1] * t1[2] - c[2] * t1[1], c[2] * t1[0] - c[0] * t1[2], c[0] * t1[1] - c[1] * t1[0]], pts = [], st = Math.sin(th), ct = Math.cos(th);
    for (var k = 0; k <= 120; k++) {
      var ph = k / 120 * TAU, x = c[0] * ct + (t1[0] * Math.cos(ph) + t2[0] * Math.sin(ph)) * st, y = c[1] * ct + (t1[1] * Math.cos(ph) + t2[1] * Math.sin(ph)) * st, z = c[2] * ct + (t1[2] * Math.cos(ph) + t2[2] * Math.sin(ph)) * st;
      this.proj(x, y, z, 1.0015, o); pts.push([o[0], o[1], o[3] && o[2] > -0.02]);
    }
    g.globalCompositeOperation = 'lighter';
    var passes = [[26, 0.07, tk.shock], [11, 0.16, tk.shock], [4.5, 0.5, tk.shockHot], [1.8, 1, tk.beamHead]];
    for (var pp = 0; pp < passes.length; pp++) {
      g.lineWidth = passes[pp][0]; g.strokeStyle = rgba(passes[pp][2], passes[pp][1] * a); g.beginPath(); var mv = false;
      for (var q = 0; q < pts.length; q++) { if (pts[q][2]) { if (!mv) { g.moveTo(pts[q][0], pts[q][1]); mv = true; } else g.lineTo(pts[q][0], pts[q][1]); } else mv = false; }
      g.stroke();
    }
  };

  P.drawFx = function (g, now) {
    var tk = this.tk, o = [0, 0, 0, 0], keep = [], R = this.R;
    if (this.moonBegin) this.moonBegin(now);
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.fx.length; i++) {
      var f = this.fx[i], u = (now - f.t0) / f.dur;
      if (u > 1) { continue; }
      keep.push(f);
      if (u < 0) continue;
      if (this.moonFx && this.moonFx(g, f, u, now)) continue;
      if (f.kind === 'shock') {
        var th = f.reach * DEG * easeOutCubic(u), a = Math.pow(1 - u, 1.7), c = f.v;
        /* ring of angular radius th around c: build basis */
        var ref = Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        var t1 = [c[1] * ref[2] - c[2] * ref[1], c[2] * ref[0] - c[0] * ref[2], c[0] * ref[1] - c[1] * ref[0]], l1 = Math.hypot(t1[0], t1[1], t1[2]); t1 = [t1[0] / l1, t1[1] / l1, t1[2] / l1];
        var t2 = [c[1] * t1[2] - c[2] * t1[1], c[2] * t1[0] - c[0] * t1[2], c[0] * t1[1] - c[1] * t1[0]];
        var pts = []; var st = Math.sin(th), ct = Math.cos(th);
        for (var k = 0; k <= 96; k++) {
          var ph = k / 96 * TAU, x = c[0] * ct + (t1[0] * Math.cos(ph) + t2[0] * Math.sin(ph)) * st, y = c[1] * ct + (t1[1] * Math.cos(ph) + t2[1] * Math.sin(ph)) * st, z = c[2] * ct + (t1[2] * Math.cos(ph) + t2[2] * Math.sin(ph)) * st;
          this.proj(x, y, z, 1.0015, o); pts.push([o[0], o[1], o[3] && o[2] > -0.02]);
        }
        var passes = [[24, 0.05, tk.shock], [10, 0.12, tk.shock], [3.6, 0.3, tk.shock], [1.4, 0.62, tk.beamHead]];
        for (var pp = 0; pp < passes.length; pp++) {
          g.lineWidth = passes[pp][0] * (1 - u * 0.5); g.strokeStyle = rgba(passes[pp][2], passes[pp][1] * a); g.beginPath(); var mv = false;
          for (var q = 0; q < pts.length; q++) { if (pts[q][2]) { if (!mv) { g.moveTo(pts[q][0], pts[q][1]); mv = true; } else g.lineTo(pts[q][0], pts[q][1]); } else mv = false; }
          g.stroke();
        }
      } else if (f.kind === 'flare') {
        var pv = this.proj(this.nx[f.node], this.ny[f.node], this.nz[f.node], 1, [0, 0, 0, 0]);
        if (pv[3]) {
          var sc = u < 0.15 ? 1 + 2.2 * easeOutCubic(u / 0.15) : 3.2 - 1.8 * easeOutCubic(clamp((u - 0.15) / 0.5, 0, 1)) * 1;
          var fr = Math.min(44, R * 0.03) * sc * (1 - u * 0.6); g.globalAlpha = 1 - u * 0.7; g.drawImage(this.hotHalo, pv[0] - fr * 2, pv[1] - fr * 2, fr * 4, fr * 4); g.drawImage(this.hotCore, pv[0] - fr * 0.5, pv[1] - fr * 0.5, fr, fr); g.globalAlpha = 1;
          var ph2 = Math.min(1, u / 0.18), fade = 1 - clamp((u - 0.18) / 0.78, 0, 1), top = this.lift(pv, 0.34 * easeOutCubic(ph2), [0, 0]);
          var gr = g.createLinearGradient(pv[0], pv[1], top[0], top[1]); gr.addColorStop(0, rgba(tk.beamHead, 0.95 * fade)); gr.addColorStop(1, rgba(tk.beamHead, 0));
          g.strokeStyle = gr; g.lineWidth = 2.2; g.beginPath(); g.moveTo(pv[0], pv[1]); g.lineTo(top[0], top[1]); g.stroke();
        }
      } else if (f.kind === 'beam') {
        var a2 = [this.nx[f.a], this.ny[f.a], this.nz[f.a]], b2 = [this.nx[f.b], this.ny[f.b], this.nz[f.b]];
        var dist = Math.acos(clamp(a2[0] * b2[0] + a2[1] * b2[1] + a2[2] * b2[2], -1, 1)), alt = 0.10 + 0.34 * Math.pow(dist / Math.PI, 0.8);
        var pp2 = []; this.arcPts(a2, b2, alt, 80, pp2);
        var head = easeInOut(u), trail = 0.2, col = tk.tier[f.tier];
        /* faint route, persists while the beam travels */
        g.lineWidth = 1; g.strokeStyle = rgba(col, 0.16 * (1 - u * 0.5)); g.beginPath(); var m3 = false;
        for (var z = 0; z < pp2.length; z++) { if (pp2[z][2]) { if (!m3) { g.moveTo(pp2[z][0], pp2[z][1]); m3 = true; } else g.lineTo(pp2[z][0], pp2[z][1]); } else m3 = false; }
        g.stroke();
        /* trail: 22 segments, three passes (glow, body, core) */
        var t0i = Math.max(0, head - trail), segN = 22;
        for (var s2 = 0; s2 < segN; s2++) {
          var ta = t0i + (head - t0i) * (s2 / segN), tb = t0i + (head - t0i) * ((s2 + 1) / segN), k = (s2 + 1) / segN;
          var ia = Math.floor(ta * 80), ib = Math.min(80, Math.floor(tb * 80) + 1);
          var passes2 = [[9, 0.10, col], [4.2, 0.4, mix(col, tk.beamHead, 0.35)], [1.8, 1, mix(col, tk.beamHead, 0.8)]];
          for (var pz = 0; pz < 3; pz++) {
            g.strokeStyle = rgba(passes2[pz][2], passes2[pz][1] * Math.pow(k, 1.5)); g.lineWidth = passes2[pz][0] * (0.35 + 0.65 * k); g.lineCap = 'round'; g.beginPath(); var mv4 = false;
            for (var w2 = ia; w2 <= ib; w2++) { var pt = pp2[w2]; if (pt && pt[2]) { if (!mv4) { g.moveTo(pt[0], pt[1]); mv4 = true; } else g.lineTo(pt[0], pt[1]); } else mv4 = false; }
            g.stroke();
          }
        }
        var hp = pp2[Math.min(80, Math.floor(head * 80))];
        if (hp && hp[2]) { g.globalAlpha = 1; g.drawImage(this.hotHalo, hp[0] - 20, hp[1] - 20, 40, 40); g.drawImage(this.hotCore, hp[0] - 5, hp[1] - 5, 10, 10); }
      } else if (f.kind === 'pulse') {
        var pn = this.proj(this.nx[f.node], this.ny[f.node], this.nz[f.node], 1, [0, 0, 0, 0]);
        if (pn[3] && pn[2] > 0.03) { var rr = 6 + 30 * easeOutExpo(u); g.strokeStyle = rgba(tk.tier[f.tier], 0.9 * (1 - u)); g.lineWidth = 2 * (1 - u) + 0.6; g.beginPath(); g.arc(pn[0], pn[1], rr, 0, TAU); g.stroke();
          g.globalAlpha = 0.6 * (1 - u); g.drawImage(this.hotHalo, pn[0] - 16, pn[1] - 16, 32, 32); g.globalAlpha = 1; }
      } else if (f.kind === 'birth') {
        var pb = this.proj(this.nx[f.node], this.ny[f.node], this.nz[f.node], 1, [0, 0, 0, 0]);
        if (pb[3]) { for (var r2 = 0; r2 < 2; r2++) { var uu = clamp((u - r2 * 0.16) / 0.5, 0, 1); if (uu <= 0) continue; g.strokeStyle = rgba(tk.select, 0.8 * (1 - uu)); g.lineWidth = 1.4; g.beginPath(); g.arc(pb[0], pb[1], 28 * easeOutExpo(uu), 0, TAU); g.stroke(); }
          var tp = this.lift(pb, 0.12 * Math.sin(Math.PI * Math.min(1, u * 1.4)), [0, 0]); g.strokeStyle = rgba(tk.select, 0.7 * (1 - u)); g.lineWidth = 1.6; g.beginPath(); g.moveTo(pb[0], pb[1]); g.lineTo(tp[0], tp[1]); g.stroke(); }
      }
    }
    this.fx = keep;
    if (this.rv && this.rv.th < Math.PI * 0.98) { this.drawRing(g, this.rv.v, this.rv.th, 1); }
    g.globalCompositeOperation = 'source-over';
    /* amount chips (source-over text) */
    for (var ci = 0; ci < this.fx.length; ci++) {
      var f3 = this.fx[ci]; if (f3.kind !== 'chip') continue; var uc = (now - f3.t0) / f3.dur; if (uc < 0 || uc > 1) continue;
      var pc = this.proj(this.nx[f3.node], this.ny[f3.node], this.nz[f3.node], 1, [0, 0, 0, 0]); if (!pc[3]) continue;
      var rise = 10 + 18 * easeOutCubic(uc), al = uc < 0.1 ? uc / 0.1 : (1 - clamp((uc - 0.55) / 0.45, 0, 1));
      var txt = f3.text + ' FLUX'; g.font = '600 12px ' + tk.fontMono; var tw = g.measureText(txt).width;
      var ci2 = this.inset || { left: 0, right: 0, top: 0, bottom: 0 }; /* a chip stays in the free area: never under the top bar, a docked window or the sheet */
      var bx = clamp(pc[0] + 10, ci2.left + 14, Math.max(ci2.left + 14, this.W - ci2.right - tw - 36)), by = Math.max(pc[1] - rise, ci2.top + 44);
      g.globalAlpha = al * 0.92; g.fillStyle = 'rgba(8,10,15,0.82)'; this.rrect(g, bx - 7, by - 12, tw + 26, 22, 11); g.fill();
      g.strokeStyle = rgba(tk.tier[f3.tier], 0.55 * al); g.lineWidth = 1; this.rrect(g, bx - 7, by - 12, tw + 26, 22, 11); g.stroke();
      g.fillStyle = rgba(tk.tier[f3.tier], 1); g.globalAlpha = al; g.beginPath(); g.arc(bx + 2, by - 1, 3, 0, TAU); g.fill();
      g.fillStyle = rgba(hex('#ffffff'), 1); g.textBaseline = 'middle'; g.fillText(txt, bx + 11, by - 0.5); g.globalAlpha = 1;
    }
    if (this.aimClear && now > this.aimClear) this.aimClear = 0;
  };

  P.rrect = function (g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };


P.drawConstel = function (g, now) {
    var c = this.constel, tk = this.tk, n = this.D.nodes, o = [0, 0, 0, 0], pts = [], list = c.list, u = easeOutCubic(clamp((now - c.t) / 700, 0, 1));
    if (c.kind === 'mine' && this.R > 1200) { this.drawFleet(g, now, c, u); return; }
    var col = c.kind === 'mine' ? tk.mine : tk.app;
    g.globalCompositeOperation = 'lighter';
    /* arcs from the first instance to the others (spec origin -> instances) */
    var a = [this.nx[list[0]], this.ny[list[0]], this.nz[list[0]]];
    for (var i = 1; i < list.length; i++) {
      var b = [this.nx[list[i]], this.ny[list[i]], this.nz[list[i]]], dist = Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1));
      if (dist < 0.004) continue;
      this.arcPts(a, b, 0.04 + 0.16 * dist / Math.PI, 40, pts);
      g.strokeStyle = rgba(col, 0.42 * u); g.lineWidth = 1.2; g.setLineDash([3, 4]); g.beginPath(); var mv = false;
      for (var k = 0; k < pts.length; k++) { if (pts[k][2]) { if (!mv) { g.moveTo(pts[k][0], pts[k][1]); mv = true; } else g.lineTo(pts[k][0], pts[k][1]); } else mv = false; }
      g.stroke(); g.setLineDash([]);
      var ph = ((now / 3600) + i * 0.21) % 1, pj = pts[Math.min(pts.length - 1, Math.floor(ph * (pts.length - 1)))];
      if (pj[2]) { g.globalAlpha = 0.9 * u; g.drawImage(this.hotHalo, pj[0] - 5, pj[1] - 5, 10, 10); g.globalAlpha = 1; }
    }
    var groups = {}, order = [];
    for (var j = 0; j < list.length; j++) {
      var idx = list[j]; this.proj(this.nx[idx], this.ny[idx], this.nz[idx], 1, o); if (!o[3] || o[2] < 0.03) continue;
      var key = Math.round(n.lat[idx] * 20) + ',' + Math.round(n.lon[idx] * 20);
      if (!groups[key]) { groups[key] = { x: o[0], y: o[1], idx: idx, n: 0, first: j === 0 }; order.push(key); } groups[key].n++;
      var t = n.tier[idx], r = 5.5 * u;
      g.globalAlpha = 0.85 * u; g.drawImage(this.hotHalo, o[0] - r * 3.6, o[1] - r * 3.6, r * 7.2, r * 7.2);
      g.globalAlpha = 1; g.drawImage(this.hotCore, o[0] - r * 0.9, o[1] - r * 0.9, r * 1.8, r * 1.8);
      g.strokeStyle = rgba(tk.tier[t], 0.95 * u); g.lineWidth = 1.5; g.beginPath(); g.arc(o[0], o[1], r * 1.3, 0, TAU); g.stroke();
      var ph2 = ((now / 2600) + j * 0.17) % 1; g.strokeStyle = rgba(col, 0.6 * (1 - ph2) * u); g.lineWidth = 1; g.beginPath(); g.arc(o[0], o[1], r * 1.5 + 20 * easeOutCubic(ph2), 0, TAU); g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
    /* labels: one pill per location */
    g.font = '500 11px ' + tk.fontMono; g.textBaseline = 'middle';
    order.forEach(function (key, qi) {
      var gr = groups[key], h = this.D.hubs[n.hub[gr.idx]], txt = h.name + (gr.n > 1 ? '  x' + gr.n : ''), w = g.measureText(txt).width, lx = gr.x + 22, ly = gr.y + (qi % 2 ? 26 : -26);
      if (lx + w + 26 > this.W - 10) lx = gr.x - 22 - (w + 26); /* flip to the left of the node rather than clip at the viewport edge */
      g.globalAlpha = u; g.fillStyle = 'rgba(8,10,15,0.78)'; this.rrect(g, lx, ly - 10, w + 26, 20, 10); g.fill();
      g.strokeStyle = rgba(tk.tier[n.tier[gr.idx]], 0.55); g.lineWidth = 1; this.rrect(g, lx, ly - 10, w + 26, 20, 10); g.stroke();
      g.fillStyle = rgba(tk.tier[n.tier[gr.idx]], 1); g.beginPath(); g.arc(lx + 10, ly, 3, 0, TAU); g.fill();
      g.fillStyle = rgba(tk.label, 1); g.fillText(txt, lx + 19, ly + 0.5); g.globalAlpha = 1;
    }, this);
  };

  /* operator fleet at host zoom: every node on the host fans out around it; one host, one point of failure */
P.drawFleet = function (g, now, c, u) {
    var tk = this.tk, n = this.D.nodes, list = c.list, N = list.length, o = this.proj(this.nx[list[0]], this.ny[list[0]], this.nz[list[0]], 1, [0, 0, 0, 0]);
    var cx = o[0], cy = o[1], rf = this.fleetRf || 132, k = rf / 132, fadeIn = u * smooth(1200, 2000, this.R), F = function (px) { return Math.round(px * (0.78 + 0.22 * k) * 10) / 10; };
    g.save(); g.globalAlpha = fadeIn;
    g.globalCompositeOperation = 'lighter';
    var fl = g.createRadialGradient(cx, cy, 0, cx, cy, rf * 2.7); fl.addColorStop(0, rgba(tk.mine, 0.20)); fl.addColorStop(0.5, rgba(tk.mine, 0.06)); fl.addColorStop(1, rgba(tk.mine, 0));
    g.fillStyle = fl; g.beginPath(); g.arc(cx, cy, rf * 2.7, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
    /* radar rings */
    g.lineWidth = 1; [0.55, 1, 1.4].forEach(function (kk, qi) { g.strokeStyle = 'rgba(141,162,255,' + (0.16 - qi * 0.04) + ')'; g.beginPath(); g.arc(cx, cy, rf * kk, 0, TAU); g.stroke(); });
    /* one point of failure: dashed ring */
    var rr = rf * 1.78;
    g.setLineDash([5, 6]); g.lineDashOffset = -now / 90; g.strokeStyle = rgba(tk.risk, 0.75); g.lineWidth = 1.4; g.beginPath(); g.arc(cx, cy, rr, 0, TAU); g.stroke(); g.setLineDash([]); g.lineDashOffset = 0;
    var cap = 'One host, one point of failure', w0; g.font = '500 ' + F(11.5) + 'px ' + tk.fontSans; w0 = g.measureText(cap).width;
    g.fillStyle = 'rgba(8,10,15,0.88)'; this.rrect(g, cx - w0 / 2 - 12, cy + rr - 11, w0 + 24, 22, 11); g.fill(); g.strokeStyle = rgba(tk.risk, 0.55); this.rrect(g, cx - w0 / 2 - 12, cy + rr - 11, w0 + 24, 22, 11); g.stroke();
    g.fillStyle = rgba(tk.risk, 1); g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(cap, cx, cy + rr + 0.5); g.textAlign = 'left';
    /* spokes and nodes */
    var nr = 12 * (0.8 + 0.2 * k);
    for (var i = 0; i < N; i++) {
      var idx = list[i], ang = -Math.PI / 2 + i * TAU / N, nx = cx + Math.cos(ang) * rf, ny = cy + Math.sin(ang) * rf, t = n.tier[idx], rank = n.rank[idx], next = rank === 0;
      g.strokeStyle = rgba(tk.tier[t], 0.4); g.lineWidth = 1; g.beginPath(); g.moveTo(cx + Math.cos(ang) * 20 * k, cy + Math.sin(ang) * 20 * k); g.lineTo(nx - Math.cos(ang) * (nr + 2), ny - Math.sin(ang) * (nr + 2)); g.stroke();
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = fadeIn * 0.9; g.drawImage(this.halo[t], nx - 34 * k, ny - 34 * k, 68 * k, 68 * k); g.globalAlpha = fadeIn; g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(8,10,15,0.92)'; g.beginPath(); g.arc(nx, ny, nr, 0, TAU); g.fill();
      g.strokeStyle = rgba(tk.tier[t], 1); g.lineWidth = next ? 2.2 : 1.6; g.beginPath(); g.arc(nx, ny, nr, 0, TAU); g.stroke();
      g.fillStyle = rgba(mix(tk.tier[t], [255, 255, 255], 0.4), 1); g.beginPath(); g.arc(nx, ny, nr * 0.35, 0, TAU); g.fill();
      if (next) { var rot = now / 2400; g.strokeStyle = rgba(tk.aim, 0.95); g.lineWidth = 1.5; g.beginPath(); g.arc(nx, ny, nr * 1.58, 0, TAU); g.stroke(); g.beginPath(); for (var kt = 0; kt < 4; kt++) { var an = rot + kt * Math.PI / 2; g.moveTo(nx + Math.cos(an) * nr * 1.38, ny + Math.sin(an) * nr * 1.38); g.lineTo(nx + Math.cos(an) * nr * 2, ny + Math.sin(an) * nr * 2); } g.stroke(); }
      /* label outside the ring */
      var off = 30 * (0.75 + 0.25 * k), lx = nx + Math.cos(ang) * off, ly = ny + Math.sin(ang) * off, right = Math.cos(ang) >= -0.2; g.textAlign = right ? 'left' : 'right';
      if (Math.abs(Math.cos(ang)) < 0.3) { g.textAlign = 'center'; ly = ny + (Math.sin(ang) < 0 ? -36 : 38) * (0.75 + 0.25 * k); lx = nx; }
      var ls = 0.78 + 0.22 * k; g.font = '600 ' + F(13) + 'px ' + tk.fontMono; g.fillStyle = 'rgba(255,255,255,1)'; g.fillText(':' + n.port[idx], lx, ly - 7 * ls);
      g.font = '500 ' + F(11) + 'px ' + tk.fontMono; g.fillStyle = next ? rgba(tk.aim, 1) : 'rgba(161,165,171,1)'; g.fillText(next ? 'next block' : '#' + (rank + 1).toLocaleString('en-US'), lx, ly + 8 * ls);
      g.textAlign = 'left';
    }
    /* the host */
    g.fillStyle = 'rgba(8,10,15,0.95)'; g.beginPath(); g.arc(cx, cy, 20 * k, 0, TAU); g.fill(); g.strokeStyle = rgba(tk.aim, 0.9); g.lineWidth = 1.8; g.beginPath(); g.arc(cx, cy, 20 * k, 0, TAU); g.stroke();
    g.fillStyle = rgba(tk.aim, 1); g.beginPath(); g.arc(cx, cy, 5 * k, 0, TAU); g.fill();
    g.font = '600 ' + F(12.5) + 'px ' + tk.fontMono; g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,1)'; var lh = 0.78 + 0.22 * k; g.fillText('65.109.26.93', cx, cy + 40 * k);
    g.font = '500 ' + F(11) + 'px ' + tk.fontSans; g.fillStyle = 'rgba(161,165,171,1)'; g.fillText('Hetzner, Helsinki', cx, cy + 40 * k + 14 * lh); g.textAlign = 'left';
    g.restore();
  };

    P.drawAim = function (g, now) {
    if (!this.aim || !this.aim.length) return;
    var tk = this.tk, o = [0, 0, 0, 0], eta = Math.max(0, (this.aimAt - now) / 1000), fast = eta < 5;
    var period = fast ? 800 : 2400, ph = (now % period) / period, breath = 1 + 0.12 * (0.5 - 0.5 * Math.cos(ph * TAU));
    var appear = easeOutCubic(clamp((now - this.aimT) / 400, 0, 1));
    g.globalCompositeOperation = 'lighter';
    for (var i = 0; i < this.aim.length; i++) {
      var a = this.aim[i]; this.proj(this.nx[a.node], this.ny[a.node], this.nz[a.node], 1, o); if (!o[3] || o[2] < 0.03) continue;
      if (a.node === this.sel) continue; var col = tk.tier[a.tier], r = 15 * breath, rot = fast ? (1 - eta / 5) * Math.PI / 2 : 0, al = tk.aimA * appear * (fast ? 1 : 0.85);
      g.strokeStyle = rgba(mix(col, tk.aim, 0.25), al); g.lineWidth = 1.2; g.beginPath(); g.arc(o[0], o[1], r, 0, TAU); g.stroke();
      g.lineWidth = 1.4; g.beginPath();
      for (var k = 0; k < 4; k++) { var an = rot + k * Math.PI / 2; g.moveTo(o[0] + Math.cos(an) * (r - 2.5), o[1] + Math.sin(an) * (r - 2.5)); g.lineTo(o[0] + Math.cos(an) * (r + 4.5), o[1] + Math.sin(an) * (r + 4.5)); }
      g.stroke();
      g.globalAlpha = 0.5 * appear; g.drawImage(this.halo[a.tier], o[0] - 18, o[1] - 18, 36, 36); g.globalAlpha = 1;
    }
    g.globalCompositeOperation = 'source-over';
    /* labels with dashed leader */
    if (this.layers.aimLabels === false) return;
    g.font = '500 11px ' + tk.fontMono; g.textBaseline = 'middle';
    for (var j = 0; j < this.aim.length; j++) {
      var b = this.aim[j]; this.proj(this.nx[b.node], this.ny[b.node], this.nz[b.node], 1, o); if (!o[3] || o[2] < 0.03) continue;
      var txt = b.label + '  ' + b.amount.toFixed(1), w = g.measureText(txt).width, lx = o[0] + (b.dx != null ? b.dx : 26), ly = o[1] + (b.dy != null ? b.dy : -22);
      lx = Math.max(this.inset.left + 10, Math.min(this.W - this.inset.right - w - 36, lx));
      g.setLineDash([2, 3]); g.strokeStyle = rgba(tk.tier[b.tier], 0.5 * appear); g.lineWidth = 1; g.beginPath(); g.moveTo(o[0] + 11, o[1] - 9); g.lineTo(lx, ly); g.stroke(); g.setLineDash([]);
      g.globalAlpha = appear; g.fillStyle = 'rgba(8,10,15,0.72)'; this.rrect(g, lx, ly - 10, w + 26, 20, 10); g.fill(); g.strokeStyle = rgba(tk.tier[b.tier], 0.5); this.rrect(g, lx, ly - 10, w + 26, 20, 10); g.stroke();
      g.fillStyle = rgba(tk.tier[b.tier], 1); g.beginPath(); g.arc(lx + 10, ly, 3, 0, TAU); g.fill();
      g.fillStyle = rgba(hex('#d5d7db'), 1); g.fillText(txt, lx + 19, ly + 0.5); g.globalAlpha = 1;
    }
  };

  P.drawBeacon = function (g, now) {
    var i = this.sel, tk = this.tk, o = [0, 0, 0, 0], D = this.D, n = D.nodes;
    this.proj(this.nx[i], this.ny[i], this.nz[i], 1, o); if (!o[3] || o[2] < 0.03) return;
    var u = this.selT ? easeOutCubic(clamp((now - this.selT) / 500, 0, 1)) : 1;
    g.globalCompositeOperation = 'lighter';
    /* ground rings: two pulses, offset half a period */
    for (var k = 0; k < 2; k++) {
      var ph = ((now / 2400) + k * 0.5) % 1, rad = 10 + 16 * easeOutCubic(ph), ring = [];
      g.strokeStyle = rgba(tk.select, 0.9 * (1 - ph) * u); g.lineWidth = 1.25; g.beginPath();
      var rr = rad / this.R, sv = vec(n.lat[i], n.lon[i]);
      var ref = Math.abs(sv[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      var t1 = [sv[1] * ref[2] - sv[2] * ref[1], sv[2] * ref[0] - sv[0] * ref[2], sv[0] * ref[1] - sv[1] * ref[0]], l1 = Math.hypot(t1[0], t1[1], t1[2]); t1 = [t1[0] / l1, t1[1] / l1, t1[2] / l1];
      var t2 = [sv[1] * t1[2] - sv[2] * t1[1], sv[2] * t1[0] - sv[0] * t1[2], sv[0] * t1[1] - sv[1] * t1[0]];
      for (var q = 0; q <= 48; q++) { var a = q / 48 * TAU, st = Math.sin(rr), ct = Math.cos(rr); var x = sv[0] * ct + (t1[0] * Math.cos(a) + t2[0] * Math.sin(a)) * st, y = sv[1] * ct + (t1[1] * Math.cos(a) + t2[1] * Math.sin(a)) * st, z = sv[2] * ct + (t1[2] * Math.cos(a) + t2[2] * Math.sin(a)) * st; var p = this.proj(x, y, z, 1, [0, 0, 0, 0]); if (q === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]); }
      g.stroke();
    }
    /* pillar */
    var h = 0.27 * u, top = this.lift(o, h, [0, 0]);
    var gr = g.createLinearGradient(o[0], o[1], top[0], top[1]); gr.addColorStop(0, rgba(tk.select, 0.95)); gr.addColorStop(0.6, rgba(tk.select, 0.35)); gr.addColorStop(1, rgba(tk.select, 0));
    g.strokeStyle = gr; g.lineWidth = 2.2; g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(top[0], top[1]); g.stroke();
    g.lineWidth = 6; g.globalAlpha = 0.16; g.beginPath(); g.moveTo(o[0], o[1]); g.lineTo(top[0], top[1]); g.stroke(); g.globalAlpha = 1;
    /* aimed: four ticks around the ring, rotating faster in the last 5 s */
    var aimed = (this.aim || []).some(function (a) { return a.node === i; });
    if (aimed) { var eta = Math.max(0, (this.aimAt - now) / 1000), fast = eta < 5, rot = fast ? (1 - eta / 5) * Math.PI / 2 : now / 9000, rr2 = 17 * (1 + 0.1 * (0.5 - 0.5 * Math.cos(((now % (fast ? 800 : 2400)) / (fast ? 800 : 2400)) * TAU)));
      g.strokeStyle = rgba(tk.tier[n.tier[i]], 0.9); g.lineWidth = 1.2; g.beginPath(); g.arc(o[0], o[1], rr2, 0, TAU); g.stroke();
      g.lineWidth = 1.5; g.strokeStyle = rgba(tk.aim, 0.95); g.beginPath();
      for (var kt = 0; kt < 4; kt++) { var an = rot + kt * Math.PI / 2; g.moveTo(o[0] + Math.cos(an) * (rr2 - 2.5), o[1] + Math.sin(an) * (rr2 - 2.5)); g.lineTo(o[0] + Math.cos(an) * (rr2 + 4.5), o[1] + Math.sin(an) * (rr2 + 4.5)); }
      g.stroke(); }
    /* core */
    var r = 5.2 * (0.5 + 0.5 * u) + 1.4; g.drawImage(this.hotHalo, o[0] - r * 3.2, o[1] - r * 3.2, r * 6.4, r * 6.4);
    g.drawImage(this.hotCore, o[0] - r, o[1] - r, r * 2, r * 2);
    g.strokeStyle = rgba(tk.tier[n.tier[i]], 0.95); g.lineWidth = 1.4; g.beginPath(); g.arc(o[0], o[1], r * 1.05, 0, TAU); g.stroke();
    /* co-hosted nodes: rings + hairlines */
    var host = D.hosts[n.host[i]]; if (host && host.nodes.length > 1) {
      /* fan the co-hosted nodes in a small screen-space arc to make the UPnP ladder visible */
      var cnt = host.nodes.length - 1, k2 = 0, p0 = o, me = this;
      host.nodes.forEach(function (j) { if (j === i) return; var ang = -Math.PI * 0.12 + k2 * (Math.PI * 0.78 / Math.max(1, cnt - 1)) + Math.PI * 0.5; var rad = 34, fx = p0[0] + Math.cos(ang) * rad, fy = p0[1] + Math.sin(ang) * rad;
        g.strokeStyle = rgba(tk.select, 0.28 * u); g.lineWidth = 0.6; g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(fx, fy); g.stroke();
        var t = n.tier[j]; g.globalAlpha = 0.95 * u; g.drawImage(D_halo(me, t), fx - 7, fy - 7, 14, 14); g.drawImage(D_core(me, t), fx - 2.6, fy - 2.6, 5.2, 5.2); g.globalAlpha = 1;
        g.strokeStyle = rgba(tk.select, 0.5 * u); g.lineWidth = 0.9; g.beginPath(); g.arc(fx, fy, 4.6, 0, TAU); g.stroke(); k2++; });
    }
    g.globalCompositeOperation = 'source-over';
  };
  function D_halo(self, t) { return self.halo[t]; }
  function D_core(self, t) { return self.core[t]; }

  P.drawLabels = function (g, band) {
    var tk = this.tk, D = this.D, o = [0, 0, 0, 0], placed = [];
    g.textBaseline = 'middle'; g.font = '500 11px ' + tk.fontMono;
    var lim = band === 0 ? 6 : (band === 1 ? 14 : 22), count = 0, keep = [], self = this;
    (this.aim || []).forEach(function (a) { var q = self.proj(self.nx[a.node], self.ny[a.node], self.nz[a.node], 1, [0, 0, 0, 0]); keep.push([q[0], q[1]]); });
    if (this.sel >= 0) { var q2 = this.proj(this.nx[this.sel], this.ny[this.sel], this.nz[this.sel], 1, [0, 0, 0, 0]); keep.push([q2[0], q2[1]]); }
    for (var i = 0; i < this.labelHubs.length && count < lim; i++) {
      var h = D.hubs[this.labelHubs[i].hub]; var v = vec(h.lat, h.lon); this.proj(v[0], v[1], v[2], 1, o);
      if (!o[3] || o[2] < 0.3) continue;
      var tx = o[0] + 10, ty = o[1] + 14, w = g.measureText(h.name).width, ok = true;
      for (var kq = 0; kq < keep.length; kq++) { if (Math.abs(o[0] - keep[kq][0]) < 70 && Math.abs(o[1] - keep[kq][1]) < 34) { ok = false; break; } }
      if (!ok) continue;
      for (var k = 0; k < placed.length; k++) { var p = placed[k]; if (tx < p[0] + p[2] + 14 && tx + w + 14 > p[0] && Math.abs(ty - p[1]) < 18) { ok = false; break; } }
      if (!ok) continue; placed.push([tx, ty, w]); count++;
      var al = 0.92 * smooth(0.3, 0.6, o[2]);
      g.globalAlpha = al; g.fillStyle = 'rgba(8,10,15,0.74)'; this.rrect(g, tx - 6, ty - 8.5, w + 12, 17, 8.5); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1; this.rrect(g, tx - 6, ty - 8.5, w + 12, 17, 8.5); g.stroke();
      g.fillStyle = rgba(tk.label, 1); g.fillText(h.name, tx, ty + 0.5); g.globalAlpha = 1;
    }
  };

  /* ---------- pointer ---------- */
  P.bindPointer = function () {
    var self = this, cv = this.canvas, drag = null;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, moved: 0 }; cv.setPointerCapture(e.pointerId); self.fly = null; self.vel = { x: 0, y: 0 }; self.idleSince = performance.now(); });
    cv.addEventListener('pointermove', function (e) {
      if (drag) { var dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY; var k = 90 / Math.max(300, self.R * 2) * (self.pose.size > 120 ? 120 / self.pose.size : 1); self.pose.lon -= dx * k; self.pose.lat = clamp(self.pose.lat + dy * k, -80, 80); self.vel = { x: dx * k * 0.5, y: dy * k * 0.5 }; self.idleSince = performance.now(); }
      else {
        var mh = self.pickMoon ? self.pickMoon(e.clientX, e.clientY) : false;
        if (mh !== self.moon.hoverOn) { self.moon.hoverOn = mh; self.emit('moonhover', { on: mh, x: e.clientX, y: e.clientY }); }
        if (mh) { if (self.hover !== -1) { self.hover = -1; self.emit('hover', { idx: -1 }); } self.emit('moonmove', { x: e.clientX, y: e.clientY }); }
        else { var h = self.pick(e.clientX, e.clientY); if (h !== self.hover) { self.hover = h; self.emit('hover', { idx: h, x: e.clientX, y: e.clientY, site: self.pickedSite }); } else if (h >= 0) self.emit('hovermove', { x: e.clientX, y: e.clientY }); }
      }
    });
    cv.addEventListener('pointerup', function (e) { var moved = drag && drag.moved; drag = null; if (moved < 4) { if (self.pickMoon && self.pickMoon(e.clientX, e.clientY)) { self.emit('moonclick', { x: e.clientX, y: e.clientY }); return; } var h = self.pick(e.clientX, e.clientY); self.emit('click', { idx: h, x: e.clientX, y: e.clientY, site: self.pickedSite }); } });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); self.pose.size = clamp(self.pose.size * Math.exp(-e.deltaY * 0.0012), 52, 1400); self.idleSince = performance.now(); }, { passive: false });
  };
  P.pick = function (mx, my) {
    var best = -1, bd = 14 * 14, o = [0, 0, 0, 0], n = this.D.nodes;
    this.pickedSite = null;
    for (var li = 0; li < this.loose.length; li++) { var i = this.loose[li]; this.proj(this.nx[i], this.ny[i], this.nz[i], 1, o); if (o[2] < 0.1) continue; var dx = o[0] - mx, dy = o[1] - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
    /* towers: distance from the pointer to the tower segment; returns the site's first node */
    var bigs = this.bigSites, tb = 12 * 12, top = [0, 0];
    for (var bi = 0; bi < bigs.length; bi++) {
      var s = bigs[bi]; this.proj(s.v[0], s.v[1], s.v[2], 1, o); if (o[2] < 0.1) continue;
      var h = Math.min(0.15, 0.0062 * Math.pow(s.n, 0.62)), bx = o[0], by = o[1]; this.lift(o, h, top);
      var vx = top[0] - bx, vy = top[1] - by, L2 = vx * vx + vy * vy || 1, u = Math.max(0, Math.min(1, ((mx - bx) * vx + (my - by) * vy) / L2)), cx2 = bx + vx * u, cy2 = by + vy * u, dd = (mx - cx2) * (mx - cx2) + (my - cy2) * (my - cy2);
      if (dd < tb) { tb = dd; this.pickedSite = s; }
    }
    if (this.pickedSite && tb < bd) { var sn = this.siteNodes[this.pickedSite.i]; return sn[0]; }
    this.pickedSite = null; return best;
  };

  window.AtlasGlobe = AtlasGlobe;
})();
