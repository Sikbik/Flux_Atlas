/* Flux Atlas design mock: the Moon. THE MOON IS THE CHAIN.
   The Flux symbol orbits the globe. Each block: a producer node sends a beam up to the moon, the moon
   fires payouts down to the three payees. Piece map: cap = Stratus, big hexagon = Nimbus, small hexagon =
   Cumulus, the slanted bar = the 0.5 FLUX dev-fund output.
   Brand rule: the symbol is drawn only in brand colours (white-on-black tonal faces, Blue Wave edges and
   glow). Tier colours live on the beams that leave it and the chips that land, never on the symbol.
   This file extends AtlasGlobe.prototype; it is the reference for design-direction.md section 7.10 (the Moon).
   The four outputs fire in the order of the coinbase: bar (dev fund), small hexagon (Cumulus), big hexagon (Nimbus), cap (Stratus).
   Orbit: a camera-locked companion, NOT world-locked. A tilted ellipse around the planet centre, clamped to
   the free viewport area, so the moon is on screen and in frame at every landing in every pose. */
(function () {
  'use strict';
  var G = window.AtlasGlobe, FB = window.FluxBrand;
  if (!G || !FB) return;
  var P = G.prototype, TAU = Math.PI * 2, DEG = Math.PI / 180;
  var SYM_W = 279.714, SYM_H = 322.975, CX = 139.857, CY = 161.4875;
  var SPARK = 0, CAP = 1, BIG = 2, SMALL = 3; /* piece order of FluxBrand.PIECES */
  var PIECE_OF_TIER = [SMALL, BIG, CAP];      /* cumulus, nimbus, stratus */

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
  function easeOutBack(t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function hex(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function rgba(c, a) { return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')'; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function tok(n, fb) { var v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || fb; }
  function radial(rgb, stops, size) {
    var c = document.createElement('canvas'); c.width = c.height = size; var g = c.getContext('2d');
    var r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(function (st) { r.addColorStop(st[0], rgba(rgb, st[1])); }); g.fillStyle = r; g.fillRect(0, 0, size, size); return c;
  }
  var WHITE = [255, 255, 255], BLACK = [0, 0, 0];

  function tk_orbit(self) { return self.tk.moon.orbit; }

  /* ---------- setup ---------- */
  P.moonInit = function (opts) {
    var g = function (n, fb) { return tok('--globe-moon-' + n, fb); };
    this.tk.moon = {
      face: [hex(g('spark', '#ffffff')), hex(g('stratus', '#ffffff')), hex(g('nimbus', '#cccccc')), hex(g('cumulus', '#7e7c7c'))], /* by piece index */
      edge: hex(g('edge', '#2b61d1')), edgeHi: hex(g('edge-hi', '#86a1da')), glow: hex(g('glow', '#2b61d1')), glowA: parseFloat(g('glow-alpha', '0.55')),
      ring: hex(g('ring', '#86a1da')), beam: hex(g('beam', '#ffffff')), size: parseFloat(g('size', '0.064')), min: parseFloat(g('size-min', '44')), max: parseFloat(g('size-max', '96')),
      orbit: parseFloat(g('orbit-s', '240')), tilt: parseFloat(g('tilt', '22')), depth: parseFloat(g('depth', '0.14'))
    };
    this.pieces = FB.path2d();
    var mq = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches, ds = document.documentElement.dataset.motion;
    this.reduced = opts.reduced != null ? !!opts.reduced : (ds === 'reduced' || (mq && ds !== 'full'));
    this.moon = { on: true, scale: opts.moonScale || 1, phase: -0.95, hover: 0, hoverOn: false, flash: 0, pf: [0, 0, 0, 0], pos: { x: -999, y: -999, s: 60, r: 44, z: 0 }, m: null, boot: null, yaw: 0, beat: 0.4, padTop: 56, ringFlash: 0, beads: [] };
    /* the chain: one bead per sealed block, left on the orbit at the moon's angle when the block arrived. Seed the last 7 blocks. */
    for (var bi = 7; bi >= 1; bi--) this.moon.beads.push({ th: -0.95 - bi * TAU * 30 / tk_orbit(this), t: -bi * 30, flash: 0 });
    var tk = this.tk.moon;
    this.moonGlow = radial(tk.glow, [[0, 0.95], [0.22, 0.5], [0.5, 0.16], [0.78, 0.04], [1, 0]], 160);
    this.moonHalo = radial(WHITE, [[0, 1], [0.28, 0.45], [0.6, 0.1], [1, 0]], 96);
  };
  P.setReduced = function (f) { this.reduced = !!f; };
  P.setBeat = function (v) { this.moon.beat = v; };
  P.setMoon = function (o) { Object.assign(this.moon, o); };
  P.setMoonBoot = function (o) { this.moon.boot = o || null; };
  P.moonState = function () { var m = this.moon; return { x: m.pos.x, y: m.pos.y, s: m.pos.s, r: m.pos.r, z: m.pos.z, visible: !!m.on && !m.boot, hover: m.hoverOn, phase: m.phase }; };
  P.moonClick = function () { var m = this.moon; this.emit('moonclick', { x: m.pos.x, y: m.pos.y, key: true }); };
  P.pickMoon = function (mx, my) {
    var m = this.moon; if (!m.on || m.boot) return false;
    var dx = mx - m.pos.x, dy = my - m.pos.y, rr = Math.max(24, m.pos.s * 0.6); return dx * dx + dy * dy < rr * rr;
  };

  P.moonUpdate = function (now, dt) {
    var m = this.moon, tk = this.tk.moon;
    m.hover += ((m.hoverOn ? 1 : 0) - m.hover) * Math.min(1, dt * 9);
    if (!this.reduced && !m.boot) { var lap = tk.orbit * (this.mode === 'ambient' ? 0.5 : 1); m.phase += dt * TAU / lap * (1 - 0.85 * m.hover); }
    m.yaw = this.reduced ? 0 : 0.2 * Math.sin(this.simT * 0.23);
  };

  /* ---------- layout: a tilted ellipse around the planet centre, clamped to the free viewport ---------- */
  P.moonLayout = function () {
    var m = this.moon, tk = this.tk.moon, W = this.W, H = this.H, ins = this.inset, amb = this.mode === 'ambient';
    var s = clamp(tk.size * Math.min(W, H), tk.min, tk.max) * m.scale * (amb ? 1.35 : 1);
    var r = s * 0.74, padT = amb ? 28 : Math.max(ins.top, 52) + m.padTop, padB = (amb ? 28 : ins.bottom + 12), padL = (amb ? 28 : ins.left + 14), padR = (amb ? 28 : ins.right + 14);
    var x0 = padL + r, x1 = W - padR - r, y0 = padT + r, y1 = H - padB - r;
    var minSpan = 2 * r + 40;
    if (x1 - x0 < minSpan) { x0 = 30 + r; x1 = W - 30 - r; }
    if (y1 - y0 < minSpan) { y0 = 60 + r; y1 = H - 40 - r; }
    var hw = (x1 - x0) / 2, hh = (y1 - y0) / 2, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    var phi = -16 * DEG, cs = Math.cos(phi), sn = Math.sin(phi), a0 = this.R * 1.32, b0 = a0 * Math.cos(tk.tilt * DEG);
    var a = Math.min(a0, hw * 1.06), b = Math.min(b0, hh * 1.06);
    var hx = Math.sqrt(a * a * cs * cs + b * b * sn * sn), hy = Math.sqrt(a * a * sn * sn + b * b * cs * cs), q = Math.min(1, hw / hx, hh / hy); a *= q; b *= q;
    var th = m.phase, ex = a * Math.cos(th), ey = b * Math.sin(th), z = Math.sin(th);
    var p = m.pos; p.x = cx + ex * cs - ey * sn; p.y = cy + ex * sn + ey * cs; p.z = z;
    p.s = s * (1 + 0.06 * z) * (1 + 0.08 * m.hover); p.r = r;
    m.orb = { cx: cx, cy: cy, a: a, b: b, cs: cs, sn: sn };
    return p;
  };
  P.moonAt = function (th) { var o = this.moon.orb; return [o.cx + o.a * Math.cos(th) * o.cs - o.b * Math.sin(th) * o.sn, o.cy + o.a * Math.cos(th) * o.sn + o.b * Math.sin(th) * o.cs]; };

  /* screen position of a piece's centre under the current moon transform */
  P.moonPiece = function (i) {
    var m = this.moon, t = m.m, pc = this.pieces[i].c;
    if (!t) return [m.pos.x, m.pos.y];
    var lx = pc[0] - CX, ly = pc[1] - CY; return [t.cx + t.sx * lx + t.sh * ly, t.cy + t.k * ly];
  };

  /* called at the start of every drawFx: fresh layout, flash accumulators reset */
  P.moonBegin = function (now) {
    var m = this.moon; this.moonLayout(); m.flash = 0; m.pf[0] = m.pf[1] = m.pf[2] = m.pf[3] = 0; m.ringFlash = 0;
  };

  /* ---------- a lit beam along a quadratic curve ---------- */
  P.bez = function (A, C, B, u) { var v = 1 - u; return [v * v * A[0] + 2 * v * u * C[0] + u * u * B[0], v * v * A[1] + 2 * v * u * C[1] + u * u * B[1]]; };
  P.bulge = function (A, B, amt, inward) {
    var mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    var ox = mx - this.cx, oy = my - this.cy; if (nx * ox + ny * oy < 0) { nx = -nx; ny = -ny; } if (inward) { nx = -nx; ny = -ny; }
    return [mx + nx * (L * amt + 10), my + ny * (L * amt + 10)];
  };
  P.drawCurveBeam = function (g, A, C, B, head, trail, cols, a, widths) {
    var S = 18, pts = [], i;
    for (i = 0; i <= 60; i++) pts.push(this.bez(A, C, B, i / 60));
    g.lineCap = 'round'; g.lineWidth = 1; g.strokeStyle = rgba(cols[1], 0.26 * a); g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (i = 1; i <= 60; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke();
    var t0 = Math.max(0, head - trail), w = widths || [12, 5.4, 2.3];
    for (var s = 0; s < S; s++) {
      var ta = t0 + (head - t0) * (s / S), tb = t0 + (head - t0) * ((s + 1) / S), k = (s + 1) / S, ia = Math.floor(ta * 60), ib = Math.min(60, Math.ceil(tb * 60));
      var passes = [[w[0], 0.10, cols[0]], [w[1], 0.4, cols[1]], [w[2], 1, cols[2]]];
      for (var q = 0; q < 3; q++) {
        g.strokeStyle = rgba(passes[q][2], passes[q][1] * Math.pow(k, 1.5) * a); g.lineWidth = passes[q][0] * (0.35 + 0.65 * k); g.beginPath(); g.moveTo(pts[ia][0], pts[ia][1]);
        for (var j = ia + 1; j <= ib; j++) g.lineTo(pts[j][0], pts[j][1]); g.stroke();
      }
    }
    var hp = this.bez(A, C, B, head); g.globalAlpha = a; g.drawImage(this.hotHalo, hp[0] - 26, hp[1] - 26, 52, 52); g.drawImage(this.hotCore, hp[0] - 6, hp[1] - 6, 12, 12); g.globalAlpha = 1;
  };

  /* endpoint for a node: its screen position, or the limb point toward it when it is on the far side */
  P.moonNodePt = function (idx, lift) {
    var o = this.proj(this.nx[idx], this.ny[idx], this.nz[idx], 1, [0, 0, 0, 0]);
    if (o[3]) { var p = lift ? this.lift(o, lift, [0, 0]) : [o[0], o[1]]; return { p: p, vis: true }; }
    var dx = o[0] - this.cx, dy = o[1] - this.cy, L = Math.hypot(dx, dy) || 1; return { p: [this.cx + dx / L * this.R, this.cy + dy / L * this.R], vis: false };
  };

  /* ---------- choreography: producer -> moon -> three payees ---------- */
  P.moonPlay = function (e, now) {
    var self = this, red = this.reduced, pv = [this.nx[e.producer], this.ny[e.producer], this.nz[e.producer]];
    if (!red) { this.fx.push({ kind: 'flare', t0: now, dur: 900, node: e.producer }); this.fx.push({ kind: 'shock', t0: now, dur: 1700, reach: 62, v: pv }); if (e.emission) this.fx.push({ kind: 'shock', t0: now + 400, dur: 2100, reach: 88, v: pv }); }
    else this.fx.push({ kind: 'flare', t0: now, dur: 700, node: e.producer, still: true });
    var tUp = now + 60, dUp = red ? 380 : 720, tRecv = tUp + dUp, gap = red ? 0 : 130, dDown = red ? 420 : 900, tStart = tRecv + (red ? 40 : 110);
    this.fx.push({ kind: 'uplink', t0: tUp, dur: dUp + 520, travel: dUp, node: e.producer });
    this.fx.push({ kind: 'recv', t0: tRecv, dur: red ? 500 : 900 });
    /* The pieces fire in the order of the coinbase's own outputs: dev fund (output 0), Cumulus (1), Nimbus (2), Stratus (3).
       Small to large, so the relay builds to the biggest payout. DOWNLINK_ORDER is the one constant: slot 0 is the bar. */
    this.fx.push({ kind: 'pflash', t0: tStart - 60, dur: red ? 400 : 340, piece: SPARK });
    this.fx.push({ kind: 'fundchip', t0: tStart + 60, dur: 2300, text: '+0.50 dev fund' });
    e.payees.slice().sort(function (a, b) { return a.tier - b.tier; }).forEach(function (p, i) {
      var t = tStart + (i + 1) * gap, pc = PIECE_OF_TIER[p.tier];
      self.fx.push({ kind: 'pflash', t0: t - 60, dur: red ? 400 : 340, piece: pc });
      self.fx.push({ kind: 'downlink', t0: t, dur: dDown + 600, travel: dDown, node: p.node, tier: p.tier, piece: pc, amount: p.amount });
      var tl = t + dDown - 40;
      self.fx.push({ kind: 'pulse', t0: tl, dur: 900, node: p.node, tier: p.tier });
      self.fx.push({ kind: 'chip', t0: tl, dur: 2400, node: p.node, tier: p.tier, text: '+' + p.amount.toFixed(2) });
    });
    this.aim = []; this.aimClear = now + 1500;
  };

  /* returns true when it handled the effect */
  P.moonFx = function (g, f, u, now) {
    var tk = this.tk, mt = tk.moon, m = this.moon, red = this.reduced, K = f.kind;
    if (K === 'pflash') { var env = Math.sin(Math.PI * clamp(u, 0, 1)); m.pf[f.piece] = Math.max(m.pf[f.piece], env); return true; }
    if (K === 'recv') {
      if (!f.bead) { f.bead = 1; if (!red) m.beads.push({ th: m.phase, t: this.simT, flash: 1 }); }
      var e0 = Math.sin(Math.PI * clamp(u * 1.25, 0, 1)); m.flash = Math.max(m.flash, red ? e0 * 0.6 : e0); m.ringFlash = Math.max(m.ringFlash, 1 - u);
      var rr = m.pos.s * (0.55 + 1.5 * easeOutExpo(u)); if (!red) { g.strokeStyle = rgba(mt.ring, 0.7 * (1 - u)); g.lineWidth = 1.6 * (1 - u) + 0.5; g.beginPath(); g.arc(m.pos.x, m.pos.y, rr, 0, TAU); g.stroke(); g.strokeStyle = rgba(WHITE, 0.45 * (1 - u)); g.lineWidth = 0.8; g.beginPath(); g.arc(m.pos.x, m.pos.y, rr * 0.86, 0, TAU); g.stroke(); }
      return true;
    }
    if (K === 'uplink') {
      var pv = this.proj(this.nx[f.node], this.ny[f.node], this.nz[f.node], 1, [0, 0, 0, 0]);
      var A = pv[3] ? this.lift(pv, 0.10, [0, 0]) : (function (s) { var dx = pv[0] - s.cx, dy = pv[1] - s.cy, L = Math.hypot(dx, dy) || 1; return [s.cx + dx / L * s.R, s.cy + dy / L * s.R]; })(this);
      var B = [m.pos.x, m.pos.y], C = this.bulge(A, B, 0.22, false), cols = [tk.shock, mix(tk.shock, WHITE, 0.4), WHITE];
      var tu = f.travel / f.dur;
      if (red) { var ar = smooth(0, 0.3, u) * (1 - smooth(0.55, 1, u)); this.drawCurveBeam(g, A, C, B, 1, 1, cols, ar, [6, 3, 1.4]); }
      else this.drawCurveBeam(g, A, C, B, easeInOut(clamp(u / tu, 0, 1)), 0.3, cols, 1 - smooth(tu, 1, u), [13, 5.8, 2.6]);
      return true;
    }
    if (K === 'downlink') {
      var A2 = this.moonPiece(f.piece), nd = this.moonNodePt(f.node, 0.025), col = tk.tier[f.tier], cols2 = [col, mix(col, WHITE, 0.22), mix(col, WHITE, 0.6)], C2 = this.bulge(A2, nd.p, 0.16, false);
      var td = f.travel / f.dur, hd = clamp(u / td, 0, 1);
      if (red) { var ar2 = smooth(0, 0.3, u) * (1 - smooth(0.6, 1, u)); this.drawCurveBeam(g, A2, C2, nd.p, 1, 1, cols2, ar2, [6, 3, 1.4]); }
      else this.drawCurveBeam(g, A2, C2, nd.p, easeOutCubic(hd) * 0.985 + 0.015 * hd, 0.28, cols2, 1 - smooth(td, 1, u));
      return true;
    }
    if (K === 'fundchip') {
      var A3 = this.moonPiece(SPARK), up = easeOutCubic(u), al = u < 0.12 ? u / 0.12 : (1 - clamp((u - 0.55) / 0.45, 0, 1)), txt = f.text;
      g.globalCompositeOperation = 'source-over'; g.font = '600 11.5px ' + tk.fontMono; var tw = g.measureText(txt).width, bx = A3[0] + 26 + 18 * up, by = A3[1] + 6 - 10 * up;
      g.globalAlpha = al * 0.92; g.fillStyle = 'rgba(8,10,15,0.84)'; this.rrect(g, bx - 7, by - 11, tw + 24, 21, 10.5); g.fill();
      g.strokeStyle = 'rgba(255,255,255,' + 0.4 * al + ')'; g.lineWidth = 1; this.rrect(g, bx - 7, by - 11, tw + 24, 21, 10.5); g.stroke();
      g.fillStyle = 'rgba(255,255,255,1)'; g.globalAlpha = al; g.beginPath(); g.arc(bx + 2, by, 2.6, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,1)'; g.textBaseline = 'middle'; g.fillText(txt, bx + 10, by + 0.5); g.globalAlpha = 1; g.globalCompositeOperation = 'lighter';
      return true;
    }
    return false;
  };

  /* pre-aim guides: faint lines from the moon's pieces to the next payees, brightening in the last 5 s */
  P.moonAim = function (g, now) {
    if (!this.layers.aim || !this.aim || !this.aim.length || this.moon.boot || this.aimClear) return;
    var tk = this.tk, eta = Math.max(0, (this.aimAt - now) / 1000), br = 0.12 + 0.3 * (1 - clamp(eta / 5, 0, 1));
    g.globalCompositeOperation = 'lighter'; g.lineWidth = 1; g.setLineDash([2, 5]);
    for (var i = 0; i < this.aim.length; i++) {
      var a = this.aim[i], A = this.moonPiece(PIECE_OF_TIER[a.tier]), nd = this.moonNodePt(a.node, 0.0); if (!nd.vis) continue;
      var C = this.bulge(A, nd.p, 0.14, false), col = tk.tier[a.tier];
      g.strokeStyle = rgba(col, br); g.beginPath(); g.moveTo(A[0], A[1]); g.quadraticCurveTo(C[0], C[1], nd.p[0], nd.p[1]); g.stroke();
    }
    g.setLineDash([]); g.globalCompositeOperation = 'source-over';
  };

  /* ---------- the body ---------- */
  P.drawMoon = function (g, now) {
    var m = this.moon; if (!m.on) return;
    this.moonAim(g, now);
    var tk = this.tk.moon, p = m.pos, b = m.boot, x = p.x, y = p.y, s = p.s, flat = 0, depth = 1, glow = 1, alpha = 1, white = 0, ring = 1, piece = null;
    var lite = document.documentElement.dataset.perf === 'lite';
    if (b) {
      var e = easeInOut(clamp(b.lift || 0, 0, 1)), sc = b.size || 220;
      x = b.cx + (p.x - b.cx) * e; y = b.cy + (p.y - b.cy) * e - Math.sin(Math.PI * e) * this.H * 0.12; s = sc + (p.s - sc) * e;
      flat = b.flat == null ? 1 - e : b.flat; depth = b.depth == null ? e : b.depth; glow = b.glow == null ? e : b.glow; white = b.white || 0; ring = b.ring == null ? e : b.ring; piece = b.pieces || null; alpha = b.alpha == null ? 1 : b.alpha;
    }
    var k = s / SYM_H, yaw = b ? (b.lift ? m.yaw * easeInOut(b.lift) : 0) : m.yaw, sx = k * Math.cos(yaw), sh = k * Math.sin(yaw) * 0.25;
    m.m = { cx: x, cy: y, sx: sx, sh: sh, k: k };
    var flash = Math.max(m.flash, white);
    g.save(); g.globalAlpha = alpha;
    /* glow: Blue Wave, additive */
    if (!lite && glow > 0.01) {
      g.globalCompositeOperation = 'lighter';
      var gs = s * 3.3; g.globalAlpha = alpha * tk.glowA * glow * (0.85 + 0.15 * Math.sin(this.simT * 1.3) + 0.4 * m.hover + 0.5 * flash); g.drawImage(this.moonGlow, x - gs / 2, y - gs / 2, gs, gs);
      if (flash > 0.01) { var hs = s * 2.0; g.globalAlpha = alpha * 0.55 * flash; g.drawImage(this.moonHalo, x - hs / 2, y - hs / 2, hs, hs); }
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = alpha;
    }
    /* the orbit, as a dotted hairline */
    if (!lite && !b && !this.reduced && m.orb) { g.save(); g.setLineDash([1.5, 7]); g.lineWidth = 1; g.strokeStyle = rgba(tk.edgeHi, 0.16); g.beginPath(); for (var oi = 0; oi <= 120; oi++) { var op = this.moonAt(oi / 120 * TAU); if (oi) g.lineTo(op[0], op[1]); else g.moveTo(op[0], op[1]); } g.stroke(); g.restore(); }
    /* the chain: a bead (the symbol's own hexagon) for every block the moon has sealed, joined by a hairline, fading as the block ages.
       The newest link runs from the last bead to the moon, so the chain visibly grows as the moon moves. Nothing here is decoration. */
    if (!lite && !b && !this.reduced) this.drawMoonChain(g, now);
    /* the block ring: a hexagon that fills over the 30 s interval */
    if (ring > 0.02) this.drawMoonRing(g, x, y, s, ring * alpha, flash);
    /* body: extruded block */
    g.translate(x, y); g.transform(sx, 0, sh, k, 0, 0); g.translate(-CX, -CY);
    var depthL = lite ? 0 : tk.depth * SYM_H * depth * (1 - flat), N = depthL > 1 ? Math.round(clamp(4 + s / 14, 5, 11)) : 0, vx = 0.62, vy = 0.78;
    for (var i = N; i >= 1; i--) {
      var f = i / N, col = mix(mix(tk.edgeHi, tk.edge, smooth(0, 0.4, f)), BLACK, 0.62 * f); g.save(); g.translate(vx * depthL * f, vy * depthL * f); g.fillStyle = rgba(col, 1);
      for (var pp = 0; pp < 4; pp++) g.fill(this.pieces[pp].path); g.restore();
    }
    var sweep = ((this.simT * 0.14) % 1.7) - 0.35;
    for (var q = 0; q < 4; q++) {
      var pcs = this.pieces[q], off = piece ? this.moonBootOffset(q, piece[q]) : null;
      if (piece) { g.save(); g.setLineDash([5 / k, 7 / k]); g.lineWidth = 1.1 / k; g.strokeStyle = rgba(tk.edgeHi, 0.34 * (1 - clamp(piece[q], 0, 1)) * alpha); g.stroke(pcs.path); g.restore(); }
      if (off && off.a <= 0.002) continue;
      var face = mix(tk.face[q], WHITE, flat); face = mix(face, WHITE, clamp(Math.max(m.pf[q] * 0.9, flash * 0.8), 0, 1));
      g.save(); if (off) { g.globalAlpha = alpha * off.a; g.translate(pcs.c[0] + off.x, pcs.c[1] + off.y); g.rotate(off.r); g.translate(-pcs.c[0], -pcs.c[1]); }
      var pfq = clamp(m.pf[q], 0, 1);
      if (pfq > 0.01 && !lite) { g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.7 * pfq * alpha; g.drawImage(this.moonHalo, pcs.c[0] - 170, pcs.c[1] - 170, 340, 340); g.restore(); } /* the firing piece blooms: white on Blue Wave, never a tier colour */
      g.fillStyle = rgba(face, 1); g.fill(pcs.path);
      if (!lite && flat < 0.6) {
        g.save(); g.clip(pcs.path); var sg = g.createLinearGradient(20, 10, 260, 320); sg.addColorStop(0, 'rgba(255,255,255,0.30)'); sg.addColorStop(0.42, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(0,8,40,0.34)'); g.fillStyle = sg; g.fillRect(-20, -20, 340, 380); g.restore();
      }
      if (!lite && !flat) {
        g.save(); g.clip(pcs.path); var lg = g.createLinearGradient(sweep * 300 - 80, sweep * 330 - 80, sweep * 300 + 80, sweep * 330 + 80); lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.5)'); lg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = lg; g.fillRect(-20, -20, 340, 380); g.restore();
        g.lineJoin = 'round'; g.lineWidth = Math.max(0.8, 1.15 / k) * (1 + 0.8 * clamp(m.pf[q], 0, 1)); g.strokeStyle = rgba(mix(tk.edgeHi, WHITE, clamp(m.pf[q], 0, 1)), 0.6 + 0.4 * clamp(m.pf[q], 0, 1)); g.stroke(pcs.path);
      }
      g.restore();
    }
    g.restore();
    /* hover selection ring */
    if (m.hover > 0.02 && !b) { g.save(); g.strokeStyle = 'rgba(255,255,255,' + (0.5 * m.hover) + ')'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, s * 0.86, 0, TAU); g.stroke(); g.restore(); }
  };

  /* the boot assembly: where a piece comes from while its arrival progress p goes 0 to 1 (mark space units) */
  var FROM = [[40, 200, 0.4], [0, -240, 0], [230, 30, 0.25], [-200, 40, -0.35]]; /* spark from below, cap from above, big hexagon from the right, small hexagon from the left */
  P.moonBootOffset = function (i, p) {
    p = clamp(p == null ? 1 : p, 0, 1); var e = easeOutBack(p), a = smooth(0, 0.3, p), f = FROM[i], r = 1 - e;
    if (this.reduced) return { x: 0, y: 0, r: 0, a: smooth(0, 0.6, p) };
    return { x: f[0] * r, y: f[1] * r, r: f[2] * r * 0.4, a: a };
  };

  /* the chain of beads (see drawMoon) */
  P.drawMoonChain = function (g, now) {
    var m = this.moon, tk = this.tk.moon, LIFE = tk.orbit * 1.15, T = this.simT, beads = m.beads, i, n, qa = this.constel ? 0.2 : 1; /* quiet in the operator fan and the app constellation, where labels need the room */
    while (beads.length && T - beads[0].t > LIFE) beads.shift();
    n = beads.length; if (!n) return;
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    /* links: bead to bead along the orbit, then the newest bead to the moon */
    for (i = 0; i < n; i++) {
      var A = beads[i], thB = i + 1 < n ? beads[i + 1].th : m.phase, age = T - A.t, fade = clamp(1 - age / LIFE, 0, 1), steps = Math.max(2, Math.ceil(Math.abs(thB - A.th) / 0.12));
      if (thB <= A.th) continue;
      g.strokeStyle = rgba(tk.edgeHi, (0.1 + 0.4 * fade) * qa); g.lineWidth = 1.1; g.beginPath();
      for (var k2 = 0; k2 <= steps; k2++) { var q = this.moonAt(A.th + (thB - A.th) * k2 / steps); if (k2) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }
      g.stroke();
    }
    /* beads: flat hexagons in Blue Wave, a white flash at birth */
    for (i = 0; i < n; i++) {
      var B = beads[i], age2 = T - B.t, f2 = clamp(1 - age2 / LIFE, 0, 1), born = clamp(1 - age2 / 1.1, 0, 1), c = this.moonAt(B.th), r = (5.4 + 3 * born) * m.scale;
      g.beginPath(); for (var v = 0; v < 6; v++) { var an = -Math.PI / 2 + v * Math.PI / 3; g.lineTo(c[0] + r * Math.cos(an), c[1] + r * Math.sin(an)); } g.closePath();
      g.fillStyle = rgba(tk.edge, (0.2 + 0.4 * f2) * qa); g.fill(); g.strokeStyle = rgba(mix(tk.edgeHi, WHITE, born), (0.4 + 0.6 * f2) * qa); g.lineWidth = 1.3; g.stroke();
    }
    g.restore();
  };

  P.drawMoonRing = function (g, x, y, s, a, flash) {
    var tk = this.tk.moon, rho = s * 0.70, v = [], i, beat = this.moon.beat;
    for (i = 0; i < 6; i++) { var ang = (-90 + 60 * i) * DEG; v.push([x + rho * Math.cos(ang), y + rho * Math.sin(ang)]); }
    g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = rgba(tk.ring, 0.16 * a); g.lineWidth = 1.1; g.beginPath(); g.moveTo(v[0][0], v[0][1]); for (i = 1; i < 6; i++) g.lineTo(v[i][0], v[i][1]); g.closePath(); g.stroke();
    var prog = clamp(beat, 0, 1) * 6, full = Math.floor(prog), part = prog - full, end = v[0];
    var path = function (w) { g.beginPath(); g.moveTo(v[0][0], v[0][1]); for (var e = 0; e < full && e < 6; e++) { var n = v[(e + 1) % 6]; g.lineTo(n[0], n[1]); end = n; } if (full < 6) { var A = v[full], B = v[(full + 1) % 6]; end = [A[0] + (B[0] - A[0]) * part, A[1] + (B[1] - A[1]) * part]; g.lineTo(end[0], end[1]); } };
    g.globalCompositeOperation = 'lighter'; path(); g.strokeStyle = rgba(tk.ring, (0.22 + 0.4 * flash) * a); g.lineWidth = 5; g.stroke();
    path(); g.strokeStyle = rgba(tk.ring, (0.85 + 0.15 * flash) * a); g.lineWidth = 1.7; g.stroke();
    g.fillStyle = rgba(WHITE, a); g.beginPath(); g.arc(end[0], end[1], 2.3, 0, TAU); g.fill();
    g.restore();
  };

  /* A still of the moon on a small canvas, for the component sheet and the docs.
     o: { w, h, size, beat, hover, flash, pf:[spark,cap,big,small], lite, yaw, sim, flat } */
  window.AtlasGlobe.moonSpecimen = function (cv, o) {
    o = o || {}; var dpr = Math.min(3, window.devicePixelRatio || 1), W = o.w || 150, H = o.h || 150;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var me = Object.create(P); me.tk = {}; me.layers = {}; me.aim = []; me.simT = o.sim == null ? 3.2 : o.sim; me.W = W; me.H = H; me.mode = '';
    me.moonInit({ reduced: true });
    var m = me.moon, sz = o.size || 84; m.pos = { x: W / 2, y: H / 2, s: sz, r: sz * 0.74, z: 0 }; m.beat = o.beat == null ? 0.4 : o.beat; m.hover = o.hover || 0;
    m.flash = o.flash || 0; m.pf = (o.pf || [0, 0, 0, 0]).slice(); m.yaw = o.yaw == null ? 0.14 : o.yaw; m.orb = null;
    if (o.flat) m.boot = { lift: 1, flat: 1, depth: 0, glow: 0, ring: 1, size: sz, cx: W / 2, cy: H / 2 };
    var root = document.documentElement, prev = root.dataset.perf; if (o.lite) root.dataset.perf = 'lite';
    me.drawMoon(g, 0);
    if (o.lite) { if (prev == null) delete root.dataset.perf; else root.dataset.perf = prev; }
  };
})();
