/* MotoRoute test-55 : « 🌀 Proposer un itinéraire »
   Le motard choisit le temps dont il dispose. L'app part de sa position GPS, prépare 8 boucles
   (retour au point de départ) dans 8 directions avec le calculateur d'itinéraires gratuit OSRM
   (sans clé), compte les virages de chaque boucle et garde les 3 plus sinueuses.
   Pour chaque proposition : tracé, km, durée estimée, nombre de virages, et boutons
   Partir (Google Maps), GPX, WhatsApp, Proposer à mon groupe (message dans la discussion du groupe). */
(function () {
  var LG = function () { try { return lang; } catch (e) { return 'fr'; } };
  var W = function (f, a, e) { var l = LG(); return l == 'ar' ? a : l == 'en' ? e : f; };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  var NB = 8;           // boucles essayées
  var KMH = 45;         // vitesse moyenne retenue sur routes sinueuses (km/h), pour choisir la taille de la boucle
  var st = { dur: 2, busy: false, prog: '', msg: '', res: [], start: null, place: '', open: false, grp: null };

  /* ---------- géométrie ---------- */
  var R = 6371000, rad = function (d) { return d * Math.PI / 180; }, deg = function (r) { return r * 180 / Math.PI; };
  function hav(a, b) { var dLa = rad(b[1] - a[1]), dLo = rad(b[0] - a[0]), h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLo / 2) * Math.sin(dLo / 2); return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
  function brg(a, b) { var y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1])), x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0])); return (deg(Math.atan2(y, x)) + 360) % 360; }
  function dest(p, b, m) { var d = m / R, t = rad(b), la = rad(p[1]), lo = rad(p[0]); var la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(t)); var lo2 = lo + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2)); return [deg(lo2), deg(la2)]; }
  /* rééchantillonne le tracé tous les ~step mètres ([lng,lat]) */
  function resample(c, step) {
    var out = [c[0]], acc = 0;
    for (var i = 1; i < c.length; i++) {
      var a = c[i - 1], b = c[i], d = hav(a, b);
      if (d === 0) continue;
      var pos = 0;
      while (acc + (d - pos) >= step) { pos += step - acc; acc = 0; var f = pos / d; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
      acc += d - pos;
    }
    return out;
  }
  /* virages : sur des tronçons de 50 m, un changement de cap cumulé ≥ 35° sur 200 m = un virage */
  function turns(c) {
    var p = resample(c, 50); if (p.length < 6) return 0;
    var h = []; for (var i = 1; i < p.length; i++) h.push(brg(p[i - 1], p[i]));
    var dh = []; for (var j = 1; j < h.length; j++) { var x = h[j] - h[j - 1]; if (x > 180) x -= 360; if (x < -180) x += 360; dh.push(x); }
    var n = 0, k = 0;
    while (k < dh.length - 4) {
      var s = dh[k] + dh[k + 1] + dh[k + 2] + dh[k + 3];
      if (Math.abs(s) >= 35 && Math.abs(s) <= 150) { n++; k += 4; } else k++;   // > 150° sur 200 m = demi-tour (impasse), pas un virage
    }
    return n;
  }
  /* part du trajet parcouru deux fois (aller-retour dans une impasse) */
  function backtrack(c) {
    var p = resample(c, 100), seen = {}, dup = 0;
    for (var i = 0; i < p.length; i++) { var key = p[i][0].toFixed(3) + ',' + p[i][1].toFixed(3); if (seen[key] != null && i - seen[key] > 5) dup++; else if (seen[key] == null) seen[key] = i; }
    return p.length ? dup / p.length : 0;
  }
  function at(c, f) { return c[Math.min(c.length - 1, Math.max(0, Math.round((c.length - 1) * f)))]; }

  /* ---------- recherche ---------- */
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  function getPos() {
    return new Promise(function (ok, ko) {
      if (!navigator.geolocation) return ko(new Error(W('GPS indisponible sur cet appareil.', 'GPS غير متوفر على هذا الجهاز.', 'GPS unavailable on this device.')));
      navigator.geolocation.getCurrentPosition(function (p) { ok([p.coords.longitude, p.coords.latitude]); },
        function (e) { ko(new Error(e && e.code == 1 ? W('Autorise la localisation pour MotoRoute.', 'اسمح بالموقع لـ MotoRoute.', 'Allow location for MotoRoute.') : W('Position introuvable : active le GPS.', 'الموقع غير متاح: فعّل GPS.', 'Position unavailable: turn on GPS.'))); },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
    });
  }
  async function placeName(p) {
    try {
      var r = await fetch('https://nominatim.openstreetmap.org/reverse?format=json&zoom=12&lat=' + p[1] + '&lon=' + p[0] + '&accept-language=' + (LG() == 'ar' ? 'ar' : LG() == 'en' ? 'en' : 'fr'));
      var j = await r.json(), a = j.address || {};
      return a.town || a.city || a.village || a.municipality || a.county || '';
    } catch (e) { return ''; }
  }
  async function search() {
    if (st.busy) return;
    st.busy = true; st.msg = ''; st.res = []; st.prog = W('Recherche de ta position…', 'البحث عن موقعك…', 'Finding your position…'); draw();
    try {
      var s = await getPos(); st.start = s;
      placeName(s).then(function (n) { st.place = n; if (!st.busy) draw(); });
      var L = st.dur * KMH * 1000, d = L / 3.45, b0 = Math.random() * 45, found = [];
      for (var i = 0; i < NB; i++) {
        st.prog = W('Recherche des routes à virages… ', 'البحث عن طرق المنعرجات… ', 'Looking for twisty roads… ') + (i + 1) + '/' + NB; draw();
        var b = b0 + i * (360 / NB), p1 = dest(s, b, d), p2 = dest(s, b + 60, d);
        var url = OSRM + [s, p1, p2, s].map(function (q) { return q[0].toFixed(5) + ',' + q[1].toFixed(5); }).join(';') + '?overview=full&geometries=geojson';
        try {
          var r = await fetch(url), j = await r.json();
          if (j.code == 'Ok' && j.routes && j.routes[0]) {
            var ro = j.routes[0], c = ro.geometry.coordinates, km = ro.distance / 1000, h = ro.duration * 1.1 / 3600;
            var t = turns(c), bt = backtrack(c);
            found.push({ c: c, km: km, h: h, t: t, tpk: t / Math.max(1, km), bt: bt, b: b });
          }
        } catch (e) {}
        if (i < NB - 1) await sleep(1100);   // le serveur gratuit demande au plus 1 requête par seconde
      }
      var good = found.filter(function (x) { return x.bt < 0.2 && x.h >= st.dur * 0.5 && x.h <= st.dur * 1.6; });
      if (good.length < 3) good = found.filter(function (x) { return x.bt < 0.3; });
      if (!good.length) good = found;
      good.sort(function (a, b) { return b.tpk - a.tpk; });
      st.res = good.slice(0, 3);
      if (!st.res.length) st.msg = W('Aucun itinéraire trouvé (connexion internet ?). Réessaie dans un instant.', 'لم يُعثر على مسار (الإنترنت؟). أعد المحاولة بعد قليل.', 'No route found (internet connection?). Try again shortly.');
    } catch (e) { st.msg = e.message || String(e); }
    st.busy = false; st.prog = ''; draw();
  }

  /* ---------- affichage ---------- */
  function svg(c, s) {
    var Wd = 320, Ht = 190, pad = 12, xs = c.map(function (p) { return p[0]; }), ys = c.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var kx = Math.cos(rad((y0 + y1) / 2)), sc = Math.min((Wd - 2 * pad) / Math.max(1e-6, (x1 - x0) * kx), (Ht - 2 * pad) / Math.max(1e-6, y1 - y0));
    var ox = (Wd - (x1 - x0) * kx * sc) / 2, oy = (Ht - (y1 - y0) * sc) / 2;
    var P = function (p) { return ((p[0] - x0) * kx * sc + ox).toFixed(1) + ',' + (Ht - ((p[1] - y0) * sc + oy)).toFixed(1); };
    var step = Math.max(1, Math.floor(c.length / 400)), pts = c.filter(function (p, i) { return i % step == 0; }).map(P).join(' ');
    var sp = P(s).split(',');
    return '<svg class="mp-svg" viewBox="0 0 ' + Wd + ' ' + Ht + '" role="img" aria-label="' + W('Tracé de la boucle', 'مسار الحلقة', 'Loop track') + '" style="width:100%;height:auto;background:rgba(127,127,127,.08);border-radius:12px">' +
      '<polyline points="' + pts + '" fill="none" stroke="var(--acc)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + sp[0] + '" cy="' + sp[1] + '" r="7" fill="#0f9d6b" stroke="#fff" stroke-width="2.5"/></svg>';
  }
  var fmtH = function (h) { var m = Math.round(h * 60 / 5) * 5; return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
  var lvl = function (x) { return x.tpk >= 1.2 ? '🌀🌀🌀' : x.tpk >= 0.5 ? '🌀🌀' : '🌀'; };
  var lvlTxt = function (x) { return x.tpk >= 1.2 ? W('très sinueux', 'كثير المنعرجات', 'very twisty') : x.tpk >= 0.5 ? W('sinueux', 'متعرّج', 'twisty') : W('peu de virages', 'منعرجات قليلة', 'few bends'); };
  function gmaps(x) {
    var s = st.start, f = function (p) { return p[1].toFixed(5) + ',' + p[0].toFixed(5); };
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + f(s) + '&destination=' + f(s) + '&waypoints=' + encodeURIComponent([at(x.c, .25), at(x.c, .5), at(x.c, .75)].map(f).join('|'));
  }
  function summary(x) {
    return '🌀 ' + W('Proposition d’itinéraire MotoRoute', 'اقتراح مسار MotoRoute', 'MotoRoute route idea') + (st.place ? ' — ' + W('départ ', 'الانطلاق ', 'from ') + st.place : '') +
      '\n' + Math.round(x.km) + ' km · ≈ ' + fmtH(x.h) + ' · ' + x.t + ' ' + W('virages', 'منعرجا', 'bends') + ' (' + lvlTxt(x) + ')' +
      '\n🧭 ' + gmaps(x);
  }
  function card() {
    var h = '<div class="card" id="mrItCard"><h3>🌀 ' + W('Proposer un itinéraire', 'اقتراح مسار', 'Suggest a route') + '</h3>' +
      '<div class="meta">' + W('Tu sors la moto sans savoir où aller ? MotoRoute cherche autour de toi des boucles avec des virages, qui reviennent à ton point de départ.', 'تخرج الدراجة ولا تعرف إلى أين؟ يبحث MotoRoute حولك عن حلقات بمنعرجات تعود إلى نقطة انطلاقك.', 'Taking the bike out with nowhere in mind? MotoRoute finds twisty loops around you that bring you back to your start.') + '</div>' +
      '<div class="meta" style="margin-top:8px"><b>' + W('Combien de temps as-tu ?', 'كم لديك من الوقت؟', 'How much time do you have?') + '</b></div><div class="row" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">' +
      [1, 2, 3, 4].map(function (v) { return '<button class="' + (st.dur == v ? 'p' : 'g') + '" data-itd="' + v + '">' + (v == 4 ? W('½ journée', 'نصف يوم', 'Half day') : v + ' h') + '</button>'; }).join('') + '</div>' +
      '<div class="row"><button class="p" data-itgo="1" ' + (st.busy ? 'disabled' : '') + '>📍 ' + W('Chercher autour de moi', 'ابحث حولي', 'Search around me') + '</button></div>';
    if (st.prog) h += '<div class="meta">⏳ ' + esc(st.prog) + '</div>';
    if (st.msg) h += '<div class="meta" style="color:#d7263d">' + esc(st.msg) + '</div>';
    st.res.forEach(function (x, i) {
      h += '<div style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px"><div class="row" style="margin-top:0;justify-content:space-between"><b>' + W('Proposition ', 'اقتراح ', 'Idea ') + (i + 1) + ' ' + lvl(x) + '</b><span class="tag">' + lvlTxt(x) + '</span></div>' +
        svg(x.c, st.start) +
        '<div class="meta"><b>' + Math.round(x.km) + ' km</b> · ≈ <b>' + fmtH(x.h) + '</b> ' + W('sans les pauses', 'دون التوقفات', 'without stops') + ' · <b>' + x.t + '</b> ' + W('virages', 'منعرجا', 'bends') + '</div>' +
        '<div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap"><a class="lnk" target="_blank" rel="noopener" href="' + esc(gmaps(x)) + '">🧭 ' + W('Partir (Google Maps)', 'انطلق (Google Maps)', 'Go (Google Maps)') + '</a>' +
        '<button class="g" data-itgpx="' + i + '">⬇ GPX</button>' +
        '<a class="lnk" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(summary(x)) + '">💬 WhatsApp</a>' +
        '<button class="g" data-itgrp="' + i + '">📣 ' + W('Proposer à mon groupe', 'اقترح على مجموعتي', 'Suggest to my group') + '</button></div>' +
        (st.grp && st.grp.i == i ? grpPicker() : '') + '</div>';
    });
    if (st.res.length) h += '<div class="meta" style="margin-top:8px">ℹ️ ' + W('Durée estimée pour une conduite tranquille, sans les pauses. Google Maps peut choisir quelques routes différentes entre les points de passage : le fichier GPX garde le tracé exact (à ouvrir dans OsmAnd, Calimoto ou Kurviger).', 'المدة تقديرية لقيادة هادئة دون توقف. قد يختار Google Maps بعض الطرق المختلفة بين النقاط: ملف GPX يحفظ المسار الدقيق.', 'Estimated for relaxed riding, without stops. Google Maps may pick slightly different roads between waypoints: the GPX file keeps the exact track.') + '</div>';
    return h + '</div>';
  }
  function myGroups() { try { return (S.groups || []).filter(function (g) { return g.srv && g.uid && g.me; }); } catch (e) { return []; } }
  function grpPicker() {
    var G = myGroups();
    if (!G.length) return '<div class="meta" style="color:#d7263d">' + W('Rejoins d’abord un groupe (onglet Groupes) pour y proposer un itinéraire.', 'انضم أولا إلى مجموعة (تبويب المجموعات) لتقترح فيها مسارا.', 'Join a group first (Groups tab) to suggest a route there.') + '</div>';
    return '<div class="row" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">' + G.map(function (g) { return '<button class="g" data-itsend="' + esc(g.uid) + '">' + esc(g.name) + '</button>'; }).join('') + '</div>' +
      (st.grp.msg ? '<div class="meta">' + esc(st.grp.msg) + '</div>' : '');
  }
  function draw() { var el = document.getElementById('mrItCard'); if (el) el.outerHTML = card(); }

  async function sendToGroup(uid) {
    var x = st.res[st.grp.i], sb = window.mrSb, u = window.mrUser && window.mrUser();
    if (!sb || !u) { st.grp.msg = W('Connecte-toi d’abord.', 'سجّل الدخول أولا.', 'Log in first.'); return draw(); }
    st.grp.msg = '⏳'; draw();
    try {
      var fn = ''; try { var p = await sb.from('profiles').select('first_name').eq('id', u.id).maybeSingle(); fn = (p.data && p.data.first_name) || ''; } catch (e) {}
      var r = await sb.from('group_messages').insert({ group_id: uid, user_id: u.id, first_name: fn, body: summary(x).slice(0, 500) });
      if (r.error) throw r.error;
      st.grp.msg = '✅ ' + W('Envoyé dans la discussion du groupe.', 'أُرسل في دردشة المجموعة.', 'Sent to the group chat.');
    } catch (e) { st.grp.msg = '⚠️ ' + ((e && e.message) || String(e)); }
    draw();
  }

  /* ---------- branchement ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-itd],[data-itgo],[data-itgpx],[data-itgrp],[data-itsend]'); if (!b) return;
    var D = b.dataset;
    if (D.itd) { st.dur = +D.itd; draw(); }
    else if (D.itgo) search();
    else if (D.itgpx) {
      var x = st.res[+D.itgpx]; if (!x || !window.mrShareGpxText) return;
      var t0 = Date.now(), nm = 'MotoRoute boucle ' + Math.round(x.km) + ' km';
      var txt = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MotoRoute" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>' + esc(nm) + '</name></metadata>\n<trk><name>' + esc(nm) + '</name><trkseg>\n' +
        x.c.map(function (p) { return '<trkpt lat="' + p[1].toFixed(6) + '" lon="' + p[0].toFixed(6) + '"></trkpt>'; }).join('\n') + '\n</trkseg></trk>\n</gpx>\n';
      window.mrShareGpxText(txt, 'motoroute-boucle-' + Math.round(x.km) + 'km-' + t0 + '.gpx');
    }
    else if (D.itgrp) { var i = +D.itgrp; st.grp = st.grp && st.grp.i == i ? null : { i: i, msg: '' }; draw(); }
    else if (D.itsend) sendToGroup(D.itsend);
  });
  try {
    if (typeof routeView == 'function') { var _rv = routeView; routeView = function (t) { return card() + _rv(t); }; }
  } catch (e) {}
  /* pour les essais */
  window.mrItin = { turns: turns, backtrack: backtrack, st: st, draw: draw };
})();
