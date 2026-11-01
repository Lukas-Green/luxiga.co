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
  if ('IntersectionObserver' in window) {
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

  /* ── CONTACT FORM ──
     form-guard: exempt same Formspree contact form already live on luxiga.co, moved out of inline script unchanged; listed as a known gap in business/standards/FORM-SPAM-GUARD.md ("luxiga.co contact and Pulse capture", no backend of ours). Honeypot stays. Turnstile needs a Worker, tracked there. */
  var form = document.getElementById('contactForm');
  var status = document.getElementById('formStatus');
  var SENT = 'Sent! I\'ll be in touch.';
  form.addEventListener('submit', async function (e) {
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
  var TOOLS = [
    { label: 'LUXIGA OS', fx: 0.66, fy: 0.20 },
    { label: 'LUXIGA Bill', fx: 0.88, fy: 0.32 },
    { label: 'Runbook', fx: 0.74, fy: 0.50 },
    { label: 'Pulse', fx: 0.92, fy: 0.60 },
    { fx: 0.80, fy: 0.14 }, { fx: 0.96, fy: 0.44 }, { fx: 0.68, fy: 0.66 }, { fx: 0.84, fy: 0.72 }
  ];
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
        label: t.label || null, x: Math.round(nx / GRID) * GRID, y: Math.round(ny / GRID) * GRID,
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
    var focus = null;
    if (mouse && !isTouch && !settled) {
      var best = 90 * 90;
      nodes.forEach(function (n) {
        if (!n.label) return;
        var d = Math.pow(n.x - mouse.x, 2) + Math.pow(n.y - mouse.y, 2);
        if (d < best) { best = d; focus = n; }
      });
    }
    nodes.forEach(function (n) {
      var tx = n === focus ? Math.max(-24, Math.min(24, (mouse.x - n.x) * 0.4)) : 0;
      var ty = n === focus ? Math.max(-24, Math.min(24, (mouse.y - n.y) * 0.4)) : 0;
      n.ox += (tx - n.ox) * 0.18; n.oy += (ty - n.oy) * 0.18;
    });

    ctx.lineWidth = 1; ctx.lineJoin = 'miter';
    nodes.forEach(function (n) {
      var frac = settled ? 1 : Math.max(0, Math.min(1, (elapsed - n.born) / 900));
      if (frac <= 0) return;
      frac = 1 - Math.pow(1 - frac, 3);
      ctx.strokeStyle = rgba(colors[n.color], n === focus ? 0.75 : (n.label ? 0.28 : 0.14));
      strokePartial(pathOf(n), frac);
      n.ready = frac >= 1;
    });

    if (!settled) {
      if (elapsed > nextPulse) {
        var c = nodes.filter(function (n) { return n.label && n.ready; });
        if (c.length) pulses.push({ n: c[Math.floor(Math.random() * c.length)], s: elapsed });
        nextPulse = elapsed + 1100 + Math.random() * 1300;
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
    // Hub socket on the X.
    ctx.fillStyle = rgba(colors.lime, 0.9);
    ctx.fillRect(hub.x - 3, hub.y - 3, 6, 6);
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
  });
  hero.addEventListener('pointerleave', function () { mouse = null; lamp.tx = hub.x; lamp.ty = hub.y - 40; });
  new IntersectionObserver(function (en) { inView = en[0].isIntersecting; if (inView) kick(); }).observe(hero);
  var onTheme = function () { readColors(); kick(); };
  new MutationObserver(onTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', onTheme);
})();
