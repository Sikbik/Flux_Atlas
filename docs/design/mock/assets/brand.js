/* Flux brand module for the design mock.
   The geometry below is copied, unmodified, from the official Flux media kit
   (assets/brand/flux/symbol/*.svg, logo/Flux_logo_blue.svg). Nothing here redraws or
   redesigns the symbol. Colours are limited to the brand guide: Blue Wave #2b61d1, white,
   black, graphite #2d2d2d, gray #7e7c7c and the book's tonal shades. Tier and status colours
   must never be passed in (the helpers do not validate; the brand checklist in
   design-direction.md section 5.1 does).

   API (classic script, no modules so the mock works from file://)
     FluxBrand.PIECES          four pieces of the symbol mark, in mark space 279.714 x 322.975
     FluxBrand.mark(o)         inline SVG string: the symbol mark (no disc)
     FluxBrand.round(o)        inline SVG string: round symbol (disc + glyph)
     FluxBrand.logo(o)         inline SVG string: round symbol + "Flux" wordmark, optional sub-brand word
     FluxBrand.hydrate(root)   fills every [data-brand="mark|round|logo"] element
     FluxBrand.path2d()        Path2D per piece, baked with the official transforms, for canvas drawing
     FluxBrand.favicon()       sets <link rel="icon"> from the round symbol
   Options: size (px, height for mark and logo, diameter for round), fill (colour or
   {cap,big,small,spark}), disc, glyph, word, wordFill, title. */
(function () {
  'use strict';
  var BLUE = '#2b61d1', WHITE = '#ffffff', GRAY = '#7e7c7c', GRAPHITE = '#2d2d2d';

  /* Mark space: 279.714 x 322.975. Each piece carries the official path data and its own
     translate(). Centres and boxes were measured with getBBox() on the official file. */
  var PIECES = [
    { id: 'spark', tier: 'devfund',  d: 'M175.03,202.425l-28.9,16.7L84.03,183.28l28.2-16.285.7-.414,1.077.622Z', t: [-6.271, 103.85], box: [77.759, 270.431, 91, 52.544], c: [123.259, 296.703] },
    { id: 'cap',   tier: 'stratus',  d: 'M326.213,116.8v33.607L265.09,115.125l-16.576-9.572-16.576,9.572-77.7,44.858-16.576,9.572v19.787l-29.9-17.259-16.576-9.572-16.576,9.572L46.5,188.307V116.8L186.356,36.06Z', t: [-46.5, -36.06], box: [0, 0, 279.713, 153.282], c: [139.857, 76.641] },
    { id: 'big',   tier: 'nimbus',   d: 'M261.9,132.948v89.715l-77.7,44.858-.1-.062-77.594-44.8V132.948L184.2,88.07Z', t: [17.819, 19.693], box: [124.325, 107.763, 155.394, 179.451], c: [202.022, 197.488] },
    { id: 'small', tier: 'cumulus',  d: 'M135.884,141.366v51.591L91.192,218.774,46.5,192.957V141.366l44.692-25.8Z', t: [-46.5, 49.17], box: [0, 164.736, 89.384, 103.208], c: [44.692, 216.34] }
  ];
  var MARK = { w: 279.714, h: 322.975, cx: 139.857, cy: 161.4875 };

  /* Round symbol (official Flux_symbol_blue-white.svg): disc plus a smaller glyph. */
  var ROUND = {
    w: 338.064, h: 335.661, cx: 169.032, cy: 167.831, rx: 169.032, ry: 167.831, g: [77.041, 61.731],
    p: [
      { id: 'spark', d: 'M144.555,190.421l-19.224,11.107-41.3-23.841,18.756-10.832.469-.276.717.413Z', t: [-32.311, 13.286] },
      { id: 'cap',   d: 'M232.54,89.764v22.352L191.887,88.647l-11.025-6.367-11.025,6.367L118.16,118.483l-11.025,6.367V138.01L87.25,126.531l-11.025-6.367L65.2,126.531l-18.7,10.79V89.764l93.02-53.7Z', t: [-46.5, -36.06] },
      { id: 'big',   d: 'M209.856,117.919V177.59l-51.678,29.835-.069-.041L106.5,177.59V117.919L158.178,88.07Z', t: [-23.815, -16.396] },
      { id: 'small', d: 'M105.95,132.727v34.314L76.225,184.212,46.5,167.041V132.727L76.225,115.57Z', t: [-46.5, -5.999] }
    ]
  };

  /* Wordmark (official Flux_logo_blue.svg): 1079.738 x 335.661 with the round symbol at left. */
  var LOGO = {
    w: 1079.738, h: 335.661, g: [76.548, 61.129], wg: [415.244, 61.129],
    word: [
      { d: 'M326.421,86.14v57.554h105.2v40.433h-105.2v79.347h-52.6V45.69H445.57V86.14Z', t: [-273.82, -45.69] },
      { d: 'M393.41,45.69h50.64V263.475H393.41Z', t: [-198.608, -45.69] },
      { d: 'M627.1,76.54v174.7H579.052v-20.8c-13.316,15.26-32.788,23.376-54.221,23.376-43.837,0-74.682-24.672-74.682-78.569V76.54h50.657v91.238c0,29.225,12.976,42.217,35.38,42.217,23.376,0,40.256-14.936,40.256-47.094V76.54Z', t: [-166.21, -33.455] },
      { d: 'M701.721,251.24l-38.313-53.59-39.557,53.59H568.59l67.2-88.015L570.875,76.54h56.812l37.085,50.981L702.761,76.54h53.9l-64.946,85.389,67.469,89.311Z', t: [-94.687, -33.455] }
    ],
    /* Sub-brand word, as in the official "Flux foundation" lockups (Foundation Logo/SVG in the media kit):
       Montserrat SemiBold 66.6 in the 335.661 high lockup, baseline 88.237. The official word starts at
       x = 699.361 and ends at 1080.361, the lockup's edge; a shorter word is right-aligned to that edge. */
    subX: 1080.361, subY: 88.237, subSize: 66.6
  };

  function pick(fill, id, dflt) {
    if (!fill) return dflt;
    if (typeof fill === 'string') return fill;
    return fill[id] || dflt;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function ttl(o) { return o.title ? '<title>' + esc(o.title) + '</title>' : ''; }
  function aria(o) { return o.title ? ' role="img" aria-label="' + esc(o.title) + '"' : ' aria-hidden="true"'; }

  function mark(o) {
    o = o || {};
    var h = o.size || 26, w = h * MARK.w / MARK.h, f = o.fill || WHITE, s = '';
    for (var i = 0; i < PIECES.length; i++) {
      var p = PIECES[i];
      s += '<path data-piece="' + p.id + '" d="' + p.d + '" transform="translate(' + p.t[0] + ' ' + p.t[1] + ')" fill="' + pick(f, p.id, WHITE) + '"/>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w.toFixed(2) + '" height="' + h + '" viewBox="0 0 ' + MARK.w + ' ' + MARK.h + '"' + aria(o) + (o.cls ? ' class="' + o.cls + '"' : '') + '>' + ttl(o) + s + '</svg>';
  }

  function roundBody(o) {
    var disc = o.disc || BLUE, glyph = o.glyph || WHITE, s = '<ellipse cx="' + ROUND.cx + '" cy="' + ROUND.cy + '" rx="' + ROUND.rx + '" ry="' + ROUND.ry + '" fill="' + disc + '"/>';
    s += '<g transform="translate(' + ROUND.g[0] + ' ' + ROUND.g[1] + ')">';
    for (var i = 0; i < ROUND.p.length; i++) {
      var p = ROUND.p[i];
      s += '<path data-piece="' + p.id + '" d="' + p.d + '" transform="translate(' + p.t[0] + ' ' + p.t[1] + ')" fill="' + pick(o.fill, p.id, glyph) + '"/>';
    }
    return s + '</g>';
  }
  function round(o) {
    o = o || {};
    var d = o.size || 26, w = d, h = d * ROUND.h / ROUND.w;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h.toFixed(2) + '" viewBox="0 0 ' + ROUND.w + ' ' + ROUND.h + '"' + aria(o) + (o.cls ? ' class="' + o.cls + '"' : '') + '>' + ttl(o) + roundBody(o) + '</svg>';
  }

  function logo(o) {
    o = o || {};
    var h = o.size || 40, w = h * LOGO.w / LOGO.h, wf = o.wordFill || BLUE;
    var s = '<ellipse cx="' + ROUND.cx + '" cy="' + ROUND.cy + '" rx="' + ROUND.rx + '" ry="' + ROUND.ry + '" fill="' + (o.disc || BLUE) + '"/>';
    s += '<g transform="translate(' + LOGO.g[0] + ' ' + LOGO.g[1] + ')">';
    for (var i = 0; i < ROUND.p.length; i++) {
      var p = ROUND.p[i];
      s += '<path d="' + p.d + '" transform="translate(' + p.t[0] + ' ' + p.t[1] + ')" fill="' + (o.glyph || WHITE) + '"/>';
    }
    s += '</g><g transform="translate(' + LOGO.wg[0] + ' ' + LOGO.wg[1] + ')">';
    for (var j = 0; j < LOGO.word.length; j++) s += '<path d="' + LOGO.word[j].d + '" transform="translate(' + LOGO.word[j].t[0] + ' ' + LOGO.word[j].t[1] + ')" fill="' + wf + '"/>';
    s += '</g>';
    if (o.word) s += '<text x="' + LOGO.subX + '" y="' + LOGO.subY + '" text-anchor="end" fill="' + (o.wordSubFill || WHITE) + '" font-size="' + LOGO.subSize + '" font-family="\'Montserrat Variable\', Montserrat, sans-serif" font-weight="600">' + esc(o.word) + '</text>';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w.toFixed(2) + '" height="' + h + '" viewBox="0 0 ' + LOGO.w + ' ' + LOGO.h + '"' + aria(o) + (o.cls ? ' class="' + o.cls + '"' : '') + '>' + ttl(o) + s + '</svg>';
  }

  /* data-brand="round" data-s="26" [data-disc] [data-glyph]; data-brand="mark" data-s=".." data-variant="blue|white|tonal|gray|graphite";
     data-brand="logo" data-s="64" data-word="atlas" data-variant="dark|light|onblue" */
  var VARIANT = {
    blue:     { fill: BLUE },
    white:    { fill: WHITE },
    tonal:    { fill: { cap: '#ffffff', big: '#cccccc', small: GRAY, spark: '#ffffff' } },
    bluetone: { fill: { cap: BLUE, big: '#4f7ad4', small: '#86a1da', spark: BLUE } },
    gray:     { fill: GRAY },
    graphite: { fill: GRAPHITE }
  };
  function hydrate(root) {
    var els = (root || document).querySelectorAll('[data-brand]');
    for (var i = 0; i < els.length; i++) {
      var e = els[i], kind = e.getAttribute('data-brand'), s = parseFloat(e.getAttribute('data-s')) || 0, v = e.getAttribute('data-variant') || '';
      var title = e.getAttribute('data-title') || '', o = { size: s || undefined, title: title };
      var html = '';
      if (kind === 'mark') { o.fill = (VARIANT[v] || VARIANT.white).fill; html = mark(o); }
      else if (kind === 'round') { o.disc = e.getAttribute('data-disc') || BLUE; o.glyph = e.getAttribute('data-glyph') || WHITE; html = round(o); }
      else if (kind === 'logo') {
        var light = v === 'light', onblue = v === 'onblue';
        o.disc = e.getAttribute('data-disc') || (light ? BLUE : WHITE);
        o.glyph = e.getAttribute('data-glyph') || (light ? WHITE : (onblue ? BLUE : '#000000'));
        o.wordFill = light ? BLUE : WHITE; o.word = e.getAttribute('data-word') || ''; o.wordSubFill = light ? GRAPHITE : WHITE;
        html = logo(o);
      }
      if (html) { e.innerHTML = html; e.classList.add('fx-brand'); }
    }
  }

  /* Canvas: each piece as a Path2D in mark space with the official transform baked in. */
  var _p2d = null;
  function path2d() {
    if (_p2d) return _p2d;
    _p2d = PIECES.map(function (p) {
      var base = new Path2D(p.d), out = new Path2D();
      out.addPath(base, new DOMMatrix().translate(p.t[0], p.t[1]));
      return { id: p.id, tier: p.tier, path: out, c: p.c, box: p.box };
    });
    return _p2d;
  }

  function favicon() {
    if (document.querySelector('link[rel="icon"]')) {
      if (!document.querySelector('meta[name="theme-color"]')) { var t = document.createElement('meta'); t.name = 'theme-color'; t.content = '#000000'; document.head.appendChild(t); }
      return; /* the page links the official files in assets/brand/ */
    }
    var svg = round({ size: 64 });
    var l = document.querySelector('link[rel="icon"]');
    if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); }
    l.type = 'image/svg+xml';
    l.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
    if (!document.querySelector('meta[name="theme-color"]')) {
      var m = document.createElement('meta'); m.name = 'theme-color'; m.content = '#000000'; document.head.appendChild(m);
    }
  }

  window.FluxBrand = { PIECES: PIECES, MARK: MARK, ROUND: ROUND, LOGO: LOGO, VARIANT: VARIANT, mark: mark, round: round, logo: logo, hydrate: hydrate, path2d: path2d, favicon: favicon, BLUE: BLUE, WHITE: WHITE, GRAY: GRAY, GRAPHITE: GRAPHITE };
  favicon();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { hydrate(); });
  else hydrate();
})();
