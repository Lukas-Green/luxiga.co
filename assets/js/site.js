(function () {
  'use strict';
  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };

  /* ── THEME TOGGLE ── */
  var toggle = document.getElementById('themeToggle');
  function currentTheme() {
    return root.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  function syncToggle() {
    var dark = currentTheme() === 'dark';
    toggle.setAttribute('aria-pressed', dark ? 'true' : 'false');
  }
  if (toggle) {
    syncToggle();
    toggle.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      store.set('theme', next);
      syncToggle();
    });
  }

  /* ── MOBILE NAV ── */
  var hamburger = document.querySelector('.hamburger');
  var mobileNav = document.getElementById('mobileNav');
  function closeMobile() {
    hamburger.classList.remove('open');
    mobileNav.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
  }
  hamburger.addEventListener('click', function () {
    var open = hamburger.classList.toggle('open');
    mobileNav.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { var first = mobileNav.querySelector('a'); if (first) first.focus(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && mobileNav.classList.contains('open')) { closeMobile(); hamburger.focus(); }
  });
  mobileNav.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', closeMobile); });

  /* ── BRAND: always scroll to top, even if the hash is already #home ── */
  document.querySelectorAll('a[href="#home"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      closeMobile();
      history.replaceState(null, '', '#home');
    });
  });

  /* ── NAV DROPDOWN (touch + keyboard) ── */
  var dropdown = document.querySelector('.nav-dropdown');
  var dropToggle = document.querySelector('.nav-dropdown-toggle');
  if (dropdown && dropToggle) {
    var dropMenu = dropdown.querySelector('.nav-dropdown-menu');
    var setDrop = function (open) { dropMenu.classList.toggle('open', open); dropToggle.setAttribute('aria-expanded', open ? 'true' : 'false'); };
    dropToggle.addEventListener('click', function (e) { e.stopPropagation(); setDrop(!dropMenu.classList.contains('open')); });
    dropMenu.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setDrop(false); }); });
    document.addEventListener('click', function (e) { if (!dropdown.contains(e.target)) setDrop(false); });
    dropdown.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setDrop(false); dropToggle.focus(); } });
  }

  /* ── ACTIVE NAV ON SCROLL ── */
  var navLinks = document.querySelectorAll('.nav-links a');
  // Inner pages mark their own link with aria-current, so only the homepage tracks scroll.
  if ('IntersectionObserver' in window && document.body.getAttribute('data-page') === 'home') {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var id = en.target.id;
        navLinks.forEach(function (l) { l.classList.toggle('active', l.getAttribute('href') === '#' + id); });
        var inMenu = document.querySelector('.nav-dropdown-menu a[href="#' + id + '"]');
        if (dropToggle) dropToggle.classList.toggle('active', !!inMenu);
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('section[id]').forEach(function (s) { spy.observe(s); });
  }

  /* ── REVEAL (also draws the lime rule on each section head) ── */
  var reveals = document.querySelectorAll('.reveal, .sec-head');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('visible'); ro.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (r) { ro.observe(r); });
  } else {
    reveals.forEach(function (r) { r.classList.add('visible'); });
  }

  /* ── SERVICES: one row open at a time ── */
  var svcs = document.querySelectorAll('.svc');
  svcs.forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) svcs.forEach(function (o) { if (o !== d) o.open = false; });
    });
  });
  // Arriving from a homepage row (services/#ai-consulting): open that row.
  function openFromHash() {
    var t = location.hash && document.getElementById(location.hash.slice(1));
    if (t && t.classList.contains('svc')) t.open = true;
  }
  openFromHash();
  window.addEventListener('hashchange', openFromHash);

  /* ── CONTACT FORM ──
     form-guard: exempt Formspree-hosted contact form, no backend of ours to run a bot check, honeypot in place */
  var form = document.getElementById('contactForm');
  var status = document.getElementById('formStatus');
  var SENT = 'Sent! I\'ll be in touch.';
  if (form) form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var hp = form.querySelector('[name="_gotcha"]');
    if (hp && hp.value) { form.reset(); status.textContent = SENT; status.className = 'form-status success'; return; }
    var btn = form.querySelector('.form-submit');
    var label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Sending...';
    status.textContent = '';
    status.className = 'form-status';
    try {
      var res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error('Server error');
      status.textContent = SENT;
      status.classList.add('success');
      form.reset();
    } catch (err) {
      status.textContent = 'Error sending message. Try emailing directly.';
      status.classList.add('error');
    }
    btn.disabled = false;
    btn.innerHTML = label;
  });

  /* ── HERO: the lit workbench ──
     A blueprint grid that the cursor lights like a lamp (LUX is light). The product names are
     terminals on a circuit, wired back into the X of the wordmark, with signals running out to them. */
  var canvas = document.getElementById('heroCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var hero = document.getElementById('home');
  var isTouch = window.matchMedia('(hover: none)').matches;
  var GRID = 32;
  // Every named terminal is a real, public piece of work. Hover shows what it is, click opens it.
  // Blurbs reuse the wording already on this page, so the hover makes no new claims.
  var TOOLS = [
    { label: 'LUXIGA OS', kind: 'Flagship', fx: 0.64, fy: 0.08, href: 'work/#projects',
      blurb: 'Your files and recordings, understood, without the cloud. Runs on your own hardware.' },
    { label: 'LUXIGA Bill', kind: 'Live', fx: 0.86, fy: 0.18, href: 'case-studies/solobill.html',
      blurb: 'Polished invoices with PDF export, client tracking and email sending, inside Google Sheets.' },
    { label: 'Runbook', kind: 'In build', fx: 0.70, fy: 0.30, href: 'work/#projects',
      blurb: 'Reads the official docs, drafts a verified flow, serves it as Guided, Standard or Expert.' },
    { label: 'Pulse', kind: 'Free assessment', fx: 0.90, fy: 0.40, href: '/audit',
      blurb: 'A 7-question read on your digital readiness. About 3 minutes, no signup.' },
    { label: 'CanvassKit', kind: 'Case study', fx: 0.64, fy: 0.52, href: 'case-studies/canvasskit.html',
      blurb: 'A field contact tracker for a nonprofit outreach team, inside Google Workspace.' },
    { label: 'goldgosling.com', kind: 'Client build', fx: 0.82, fy: 0.62, href: 'https://goldgosling.com', ext: true,
      blurb: 'Marketing site, affiliate and QR tracking, an admin panel and automated lead alerts.' },
    { label: 'lukasdgreen.com', kind: 'Portfolio', fx: 0.66, fy: 0.74, href: 'https://lukasdgreen.com', ext: true,
      blurb: 'My studio portfolio.' },
    { fx: 0.78, fy: 0.04 }, { fx: 0.97, fy: 0.30 }, { fx: 0.96, fy: 0.56 }, { fx: 0.94, fy: 0.72 }
  ];
  var pinned = null, hot = null;
  var W, H, dpr, hub, busY, spineX, nodes = [], showNodes = false, lite = false;
  var lamp = { x: 0, y: 0, tx: 0, ty: 0 }, mouse = null, colors = {};
  var t0 = 0, raf = null, inView = true, pulses = [], nextPulse = 1600;

  function readColors() {
    var cs = getComputedStyle(root);
    colors.ink = cs.getPropertyValue('--ink').trim() || '#ECEBE4';
    colors.lime = cs.getPropertyValue('--x-lime').trim() || '#C4FF53';
    colors.violet = cs.getPropertyValue('--x-violet').trim() || '#8B5CF6';
    colors.bg = cs.getPropertyValue('--bg').trim() || '#0B0B0F';
  }
  function rgba(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function layout() {
    var r = hero.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lite = W < 769;
    var x = hero.querySelector('.hero-wordmark .wm-x');
    var wm = hero.querySelector('.hero-wordmark');
    if (x) { var xr = x.getBoundingClientRect(); hub = { x: xr.left + xr.width / 2 - r.left, y: xr.top - r.top }; }
    else hub = { x: W * 0.4, y: H * 0.8 };
    var wmTop = wm ? wm.getBoundingClientRect().top - r.top : H * 0.8;
    busY = Math.round((wmTop - 28) / GRID) * GRID;
    // Keep the circuit to the right of the copy so it never runs under the text.
    var textRight = 0;
    // Measure the visible pieces, not their full-width containers.
    hero.querySelectorAll('.hero-title, .hero-lede, .hero-byline, .hero-ctas .btn, .hero-meta span').forEach(function (el) {
      var b = el.getBoundingClientRect(); textRight = Math.max(textRight, b.right - r.left);
    });
    spineX = Math.round((Math.max(W * 0.6, textRight + 56)) / GRID) * GRID;
    showNodes = !lite && (W - spineX) > 260;
    nodes = TOOLS.map(function (t, i) {
      var nx = spineX + 48 + (W - spineX - 150) * ((t.fx - 0.6) / 0.38);
      var ny = 80 + (busY - 140) * (t.fy / 0.75);
      return {
        label: t.label || null, kind: t.kind, blurb: t.blurb, href: t.href, ext: t.ext,
        x: Math.round(nx / GRID) * GRID, y: Math.round(ny / GRID) * GRID,
        ox: 0, oy: 0, born: 200 + i * 110, flash: -1e9, color: i % 2 ? 'violet' : 'lime'
      };
    }).filter(function (n) { return n.y < busY - GRID && n.x < W - 40; });
    if (!mouse) { lamp.x = lamp.tx = hub.x; lamp.y = lamp.ty = hub.y - 40; }
  }

  function pathOf(n) {
    var ex = n.x + n.ox, ey = n.y + n.oy;
    return [[hub.x, hub.y], [hub.x, busY], [spineX, busY], [spineX, ey], [ex, ey]];
  }
  function lengthOf(p) { var L = 0; for (var i = 1; i < p.length; i++) L += Math.abs(p[i][0] - p[i - 1][0]) + Math.abs(p[i][1] - p[i - 1][1]); return L; }
  function pointAt(p, d) {
    for (var i = 1; i < p.length; i++) {
      var seg = Math.abs(p[i][0] - p[i - 1][0]) + Math.abs(p[i][1] - p[i - 1][1]);
      if (d <= seg) { var k = seg ? d / seg : 0; return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k]; }
      d -= seg;
    }
    return p[p.length - 1];
  }
  function strokePartial(p, frac) {
    var L = lengthOf(p) * frac;
    ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
    for (var i = 1; i < p.length && L > 0; i++) {
      var seg = Math.abs(p[i][0] - p[i - 1][0]) + Math.abs(p[i][1] - p[i - 1][1]);
      if (L >= seg) { ctx.lineTo(p[i][0], p[i][1]); L -= seg; }
      else { var q = pointAt(p.slice(i - 1, i + 1), L); ctx.lineTo(q[0], q[1]); L = 0; }
    }
    ctx.stroke();
  }

  function drawGrid() {
    var R = lite ? Math.min(W, 520) * 0.6 : 260;
    // Base grid, barely there.
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(colors.ink, 0.04);
    ctx.beginPath();
    for (var x = GRID + 0.5; x < W; x += GRID) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (var y = GRID + 0.5; y < H; y += GRID) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // The lamp: a pool of light, and the same grid drawn brighter inside it.
    var pool = ctx.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, R * 1.3);
    pool.addColorStop(0, rgba(colors.lime, 0.10));
    pool.addColorStop(1, rgba(colors.lime, 0));
    ctx.fillStyle = pool; ctx.fillRect(0, 0, W, H);
    var g = ctx.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, R);
    g.addColorStop(0, rgba(colors.ink, 0.20));
    g.addColorStop(1, rgba(colors.ink, 0));
    ctx.strokeStyle = g;
    ctx.beginPath();
    var x0 = Math.max(0, lamp.x - R), x1 = Math.min(W, lamp.x + R), y0 = Math.max(0, lamp.y - R), y1 = Math.min(H, lamp.y + R);
    for (x = Math.ceil(x0 / GRID) * GRID + 0.5; x < x1; x += GRID) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (y = Math.ceil(y0 / GRID) * GRID + 0.5; y < y1; y += GRID) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
  }

  function drawCircuit(elapsed) {
    if (!showNodes) return;
    var settled = reduceMotion;
    // Magnetic focus: the nearest named terminal leans toward the cursor and its label lights up.
    var focus = pinned;
    if (mouse && !isTouch) {
      var best = 90 * 90;
      nodes.forEach(function (n) {
        if (!n.label) return;
        var d = Math.pow(n.x - mouse.x, 2) + Math.pow(n.y - mouse.y, 2);
        if (d < best) { best = d; focus = n; }
      });
    }
    nodes.forEach(function (n) {
      var lean = n === focus && mouse && !settled;
      var tx = lean ? Math.max(-24, Math.min(24, (mouse.x - n.x) * 0.4)) : 0;
      var ty = lean ? Math.max(-24, Math.min(24, (mouse.y - n.y) * 0.4)) : 0;
      n.ox += (tx - n.ox) * 0.18; n.oy += (ty - n.oy) * 0.18;
    });

    ctx.lineWidth = 1; ctx.lineJoin = 'miter';
    nodes.forEach(function (n) {
      var frac = settled ? 1 : Math.max(0, Math.min(1, (elapsed - n.born) / 900));
      if (frac <= 0) return;
      frac = 1 - Math.pow(1 - frac, 3);
      var dim = focus && n !== focus ? 0.5 : 1;
      ctx.strokeStyle = rgba(colors[n.color], n === focus ? 0.75 : (n.label ? 0.28 : 0.14) * dim);
      strokePartial(pathOf(n), frac);
      n.ready = frac >= 1;
    });

    if (!settled) {
      if (elapsed > nextPulse) {
        var c = nodes.filter(function (n) { return n.label && n.ready; });
        if (c.length) pulses.push({ n: c[Math.floor(Math.random() * c.length)], s: elapsed });
        nextPulse = elapsed + 1100 + Math.random() * 1300;
      }
      // While a terminal is in focus, keep a signal running out to it.
      if (focus && focus.ready && !pulses.some(function (p) { return p.n === focus && elapsed - p.s < 700; })) {
        pulses.push({ n: focus, s: elapsed });
      }
      pulses = pulses.filter(function (p) {
        var path = pathOf(p.n), pr = (elapsed - p.s) / 1300;
        if (pr >= 1) { p.n.flash = elapsed; return false; }
        var e = pr < 0.5 ? 2 * pr * pr : 1 - Math.pow(-2 * pr + 2, 2) / 2;
        var q = pointAt(path, lengthOf(path) * e);
        ctx.fillStyle = rgba(colors[p.n.color], 0.95);
        ctx.fillRect(q[0] - 2.5, q[1] - 2.5, 5, 5);
        return true;
      });
    }

    ctx.font = '700 11px "Space Mono", monospace';
    ctx.textBaseline = 'middle';
    nodes.forEach(function (n) {
      if (!n.ready && !settled) return;
      var x = n.x + n.ox, y = n.y + n.oy;
      var flash = Math.max(0, 1 - (elapsed - n.flash) / 700);
      var s = n.label ? 8 : 4;
      if (n.label) {
        ctx.fillStyle = rgba(colors.bg, 1);
        ctx.fillRect(x - s / 2 - 3, y - s / 2 - 3, s + 6, s + 6);
        ctx.strokeStyle = rgba(colors[n.color], 0.5 + flash * 0.5);
        ctx.strokeRect(x - s / 2 - 3.5, y - s / 2 - 3.5, s + 7, s + 7);
      }
      ctx.fillStyle = rgba(colors[n.color], n.label ? 0.85 + flash * 0.15 : 0.45);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      if (n.label) {
        var on = n === focus || flash > 0;
        ctx.fillStyle = rgba(colors.ink, on ? 1 : 0.62);
        ctx.fillText(n.label.toUpperCase(), x + 14, y + 0.5);
      }
    });
    if (focus && (focus.ready || settled)) drawCard(focus);
    // Hub socket on the X.
    ctx.fillStyle = rgba(colors.lime, 0.9);
    ctx.fillRect(hub.x - 3, hub.y - 3, 6, 6);
  }

  function wrapText(text, maxW) {
    var words = text.split(' '), lines = [], line = '';
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines;
  }
  // The hover card: what the terminal is, and where clicking it goes. Kept right of the spine
  // so it never sits under the hero copy.
  function drawCard(n) {
    var x = n.x + n.ox, y = n.y + n.oy, pad = 14;
    var cw = Math.min(260, W - spineX - 24);
    ctx.font = '400 13px "Space Grotesk", sans-serif';
    var lines = wrapText(n.blurb, cw - pad * 2);
    var ch = pad + 14 + 8 + lines.length * 18 + 10 + 14 + pad;
    var cx = Math.max(spineX + 12, Math.min(W - cw - 12, x - 20));
    var cy = y + 22;
    if (cy + ch > busY - 8) cy = y - 22 - ch;
    ctx.fillStyle = rgba(colors.bg, 0.94);
    ctx.fillRect(cx, cy, cw, ch);
    ctx.strokeStyle = rgba(colors[n.color], 0.8);
    ctx.lineWidth = 1;
    ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1);
    ctx.fillStyle = rgba(colors[n.color], 1);
    ctx.fillRect(cx, cy, 3, ch);
    ctx.textBaseline = 'top';
    ctx.font = '700 10px "Space Mono", monospace';
    ctx.fillStyle = rgba(colors.ink, 0.7);
    ctx.fillText(n.kind.toUpperCase(), cx + pad, cy + pad);
    ctx.font = '400 13px "Space Grotesk", sans-serif';
    ctx.fillStyle = rgba(colors.ink, 1);
    lines.forEach(function (l, i) { ctx.fillText(l, cx + pad, cy + pad + 22 + i * 18); });
    ctx.font = '700 10px "Space Mono", monospace';
    ctx.fillStyle = rgba(colors.ink, 0.85);
    var cue = isTouch ? (pinned === n ? 'TAP AGAIN TO OPEN' : 'TAP TO OPEN') : 'CLICK TO OPEN';
    ctx.fillText(cue + (n.ext ? ' ↗' : ' →'), cx + pad, cy + ch - pad - 12);
    ctx.textBaseline = 'middle';
  }

  function hitNode(px, py) {
    var hit = null, best = 26 * 26;
    nodes.forEach(function (n) {
      if (!n.label || !n.ready) return;
      var d = Math.pow(n.x + n.ox - px, 2) + Math.pow(n.y + n.oy - py, 2);
      if (d < best) { best = d; hit = n; }
    });
    return hit;
  }
  function openNode(n) {
    if (n.ext) window.open(n.href, '_blank', 'noopener');
    else window.location.href = n.href;
  }

  function frame(ts) {
    if (!t0) t0 = ts;
    var elapsed = ts - t0;
    lamp.x += (lamp.tx - lamp.x) * 0.12; lamp.y += (lamp.ty - lamp.y) * 0.12;
    ctx.clearRect(0, 0, W, H);
    drawGrid();
    drawCircuit(elapsed);
    var still = reduceMotion || lite;
    if (still) { raf = null; return; }
    raf = inView ? requestAnimationFrame(frame) : null;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  readColors(); layout(); kick();
  window.addEventListener('resize', function () { layout(); kick(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { layout(); kick(); });
  hero.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    var r = hero.getBoundingClientRect();
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    lamp.tx = mouse.x; lamp.ty = mouse.y;
    var onCopy = e.target.closest && e.target.closest('a, button, h1, p');
    hot = showNodes && !onCopy ? hitNode(mouse.x, mouse.y) : null;
    hero.style.cursor = hot ? 'pointer' : '';
    kick();
  });
  hero.addEventListener('pointerleave', function () { mouse = null; hot = null; hero.style.cursor = ''; lamp.tx = hub.x; lamp.ty = hub.y - 40; kick(); });
  hero.addEventListener('click', function (e) {
    if (!showNodes || (e.target.closest && e.target.closest('a, button'))) return;
    var r = hero.getBoundingClientRect();
    var n = hitNode(e.clientX - r.left, e.clientY - r.top);
    if (!n) { if (pinned) { pinned = null; kick(); } return; }
    // Touch has no hover: the first tap shows the card, the second opens it.
    if (isTouch && pinned !== n) { pinned = n; kick(); return; }
    openNode(n);
  });
  new IntersectionObserver(function (en) { inView = en[0].isIntersecting; if (inView) kick(); }).observe(hero);
  var onTheme = function () { readColors(); kick(); };
  new MutationObserver(onTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', onTheme);
})();
