/* MotoRoute test-56 : « 🌀 Proposer un itinéraire » — en tête de l'onglet Sorties.
   Choix du motard :
   - genre de route : 🌀 sinueuse (virages) ou 🛣️ dégagée (autoroute, nationale, lignes droites) ;
   - « Passer par » une ville (facultatif, ex. Mostaganem) ;
   - 🔁 boucle (retour chez moi) ou ➡️ aller simple (avec une ville) ;
   - sans ville : le temps dont il dispose (30 min à une journée).
   L'app part de la position GPS, demande 8 variantes au calculateur d'itinéraires gratuit OSRM (sans clé),
   compte les virages de chacune et garde les 3 qui collent le mieux au genre de route choisi.
   Pour chaque proposition : tracé, km, durée, vitesse moyenne, virages, et
   🏙️ villes traversées (km et heure de passage), Partir (Google Maps), GPX, WhatsApp, Proposer à mon groupe. */
(function () {
  var LG = function () { try { return lang; } catch (e) { return 'fr'; } };
  var W = function (f, a, e) { var l = LG(); return l == 'ar' ? a : l == 'en' ? e : f; };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  var NOM = 'https://nominatim.openstreetmap.org/';
  var NB = 8;                       // variantes demandées
  var KMH = { tw: 45, op: 70 };     // vitesse moyenne retenue (km/h) pour dimensionner une boucle sans ville
  var DURS = [0.5, 1, 1.5, 2, 3, 4, 6, 8];
  var st = { open: false, kind: 'tw', mode: 'loop', dur: 2, city: '', via: null, busy: false, prog: '', msg: '', res: [], start: null, place: '', grp: null, det: {} };

  /* ---------- géométrie ([lng, lat]) ---------- */
  var R = 6371000, rad = function (d) { return d * Math.PI / 180; }, deg = function (r) { return r * 180 / Math.PI; };
  function hav(a, b) { var dLa = rad(b[1] - a[1]), dLo = rad(b[0] - a[0]), h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLo / 2) * Math.sin(dLo / 2); return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
  function brg(a, b) { var y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1])), x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0])); return (deg(Math.atan2(y, x)) + 360) % 360; }
  function dest(p, b, m) { var d = m / R, t = rad(b), la = rad(p[1]), lo = rad(p[0]); var la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(t)); var lo2 = lo + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2)); return [deg(lo2), deg(la2)]; }
  function resample(c, step) {
    var out = [c[0]], acc = 0;
    for (var i = 1; i < c.length; i++) {
      var a = c[i - 1], b = c[i], d = hav(a, b); if (d === 0) continue;
      var pos = 0;
      while (acc + (d - pos) >= step) { pos += step - acc; acc = 0; var f = pos / d; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
      acc += d - pos;
    }
    return out;
  }
  /* virage = cap qui tourne d'au moins 35° sur 200 m (au-delà de 150° = demi-tour, pas compté) */
  function turns(c) {
    var p = resample(c, 50); if (p.length < 6) return 0;
    var h = []; for (var i = 1; i < p.length; i++) h.push(brg(p[i - 1], p[i]));
    var dh = []; for (var j = 1; j < h.length; j++) { var x = h[j] - h[j - 1]; if (x > 180) x -= 360; if (x < -180) x += 360; dh.push(x); }
    var n = 0, k = 0;
    while (k < dh.length - 4) { var s = dh[k] + dh[k + 1] + dh[k + 2] + dh[k + 3]; if (Math.abs(s) >= 35 && Math.abs(s) <= 150) { n++; k += 4; } else k++; }
    return n;
  }
  /* part du trajet parcourue deux fois (impasse, aller-retour sur la même route) */
  function backtrack(c) {
    var p = resample(c, 100), seen = {}, dup = 0;
    for (var i = 0; i < p.length; i++) { var key = p[i][0].toFixed(3) + ',' + p[i][1].toFixed(3); if (seen[key] != null && i - seen[key] > 5) dup++; else if (seen[key] == null) seen[key] = i; }
    return p.length ? dup / p.length : 0;
  }
  function at(c, f) { return c[Math.min(c.length - 1, Math.max(0, Math.round((c.length - 1) * f)))]; }
  /* point situé à la fraction f du trajet, et km cumulés */
  function cum(c) { var k = [0]; for (var i = 1; i < c.length; i++) k.push(k[i - 1] + hav(c[i - 1], c[i])); return k; }

  /* ---------- services ---------- */
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var nomLang = function () { return LG() == 'ar' ? 'ar' : LG() == 'en' ? 'en' : 'fr'; };
  function getPos() {
    return new Promise(function (ok, ko) {
      if (!navigator.geolocation) return ko(new Error(W('GPS indisponible sur cet appareil.', 'GPS غير متوفر على هذا الجهاز.', 'GPS unavailable on this device.')));
      navigator.geolocation.getCurrentPosition(function (p) { ok([p.coords.longitude, p.coords.latitude]); },
        function (e) { ko(new Error(e && e.code == 1 ? W('Autorise la localisation pour MotoRoute.', 'اسمح بالموقع لـ MotoRoute.', 'Allow location for MotoRoute.') : W('Position introuvable : active le GPS.', 'الموقع غير متاح: فعّل GPS.', 'Position unavailable: turn on GPS.'))); },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
    });
  }
  function townOf(a) { return a.city || a.town || a.village || a.municipality || a.suburb || a.county || ''; }
  async function reverse(p, zoom) {
    try { var r = await fetch(NOM + 'reverse?format=json&zoom=' + (zoom || 10) + '&lat=' + p[1].toFixed(5) + '&lon=' + p[0].toFixed(5) + '&accept-language=' + nomLang()); var j = await r.json(), a = j.address || {}; return { t: townOf(a), w: a.state || a.province || '' }; } catch (e) { return { t: '', w: '' }; }
  }
  async function geocode(q) {
    var u = NOM + 'search?format=json&limit=1&accept-language=' + nomLang() + '&q=' + encodeURIComponent(q);
    var r = await fetch(u + '&countrycodes=dz'), j = await r.json();
    if (!j.length) { await sleep(1100); r = await fetch(u); j = await r.json(); }
    if (!j.length) throw new Error(W('Ville introuvable : « ', 'لم يُعثر على المدينة: « ', 'Town not found: “') + q + W(' ». Vérifie l’orthographe.', ' ». تحقّق من الكتابة.', '”. Check the spelling.'));
    return { p: [+j[0].lon, +j[0].lat], name: String(j[0].display_name || q).split(',').slice(0, 2).join(',') };
  }
  async function osrm(pts, steps) {
    var url = OSRM + pts.map(function (q) { return q[0].toFixed(5) + ',' + q[1].toFixed(5); }).join(';') + '?overview=full&geometries=geojson' + (steps ? '&steps=true' : '');
    var r = await fetch(url), j = await r.json();
    if (j.code != 'Ok' || !j.routes || !j.routes[0]) throw new Error(j.message || j.code || 'OSRM');
    return j.routes[0];
  }

  /* ---------- variantes à demander ---------- */
  function plans(s) {
    var P = [];
    if (st.via) {
      var C = st.via.p, D = hav(s, C), B = brg(s, C), mid = function (f, off, from, to) { var b = brg(from, to), d = hav(from, to), m = dest(from, b, d * f); return off ? dest(m, b + 90, d * off) : m; };
      if (D < 3000) throw new Error(W('Cette ville est juste à côté de toi : choisis une ville plus loin.', 'هذه المدينة قريبة جدا منك: اختر مدينة أبعد.', 'That town is right next to you: pick one further away.'));
      if (st.mode == 'loop') {
        [[0, 0], [.2, -.2], [-.2, .2], [0, .3], [.3, 0], [0, -.3], [-.3, 0], [.15, -.35]].forEach(function (o) {
          var pts = [s]; if (o[0]) pts.push(mid(.5, o[0], s, C)); pts.push(C); if (o[1]) pts.push(mid(.5, o[1], C, s)); pts.push(s); P.push(pts);
        });
      } else {
        [0, .1, -.1, .2, -.2, .3, -.3, .4].forEach(function (o) { var pts = [s]; if (o) pts.push(mid(.5, o, s, C)); pts.push(C); P.push(pts); });
      }
    } else {
      var L = st.dur * KMH[st.kind] * 1000, d = L / 3.45, b0 = Math.random() * 45;
      for (var i = 0; i < NB; i++) { var b = b0 + i * (360 / NB); P.push([s, dest(s, b, d), dest(s, b + 60, d), s]); }
    }
    return P;
  }

  /* ---------- recherche ---------- */
  async function search() {
    if (st.busy) return;
    st.busy = true; st.msg = ''; st.res = []; st.det = {}; st.grp = null; st.via = null;
    st.prog = W('Recherche de ta position…', 'البحث عن موقعك…', 'Finding your position…'); draw();
    try {
      var s = await getPos(); st.start = s;
      var q = (st.city || '').trim();
      if (q) { st.prog = W('Recherche de la ville…', 'البحث عن المدينة…', 'Finding the town…'); draw(); st.via = await geocode(q); await sleep(1100); }
      reverse(s, 12).then(function (x) { st.place = x.t; });
      var P = plans(s), found = [];
      for (var i = 0; i < P.length; i++) {
        st.prog = (st.kind == 'tw' ? W('Recherche des routes à virages… ', 'البحث عن طرق المنعرجات… ', 'Looking for twisty roads… ') : W('Recherche des routes dégagées… ', 'البحث عن طرق مفتوحة… ', 'Looking for open roads… ')) + (i + 1) + '/' + P.length; draw();
        try {
          var ro = await osrm(P[i]), c = ro.geometry.coordinates, km = ro.distance / 1000, h = ro.duration * 1.1 / 3600, t = turns(c);
          if (!found.some(function (y) { return Math.abs(y.km - km) < 0.5 && Math.abs(y.t - t) < 2; }))
            found.push({ c: c, km: km, h: h, t: t, tpk: t / Math.max(1, km), bt: backtrack(c), wp: P[i] });
        } catch (e) {}
        if (i < P.length - 1) await sleep(1100);   // le serveur gratuit demande au plus 1 requête par seconde
      }
      var lim = st.mode == 'loop' && !st.via ? 0.2 : 0.35;
      var good = found.filter(function (x) { return x.bt < lim && (st.via || (x.h >= st.dur * 0.5 && x.h <= st.dur * 1.6)); });
      if (good.length < 3) good = found.filter(function (x) { return x.bt < 0.4; });
      if (!good.length) good = found;
      /* sinueuse : le plus de virages au km ; dégagée : le moins de virages au km, puis la vitesse moyenne la plus haute */
      if (st.kind == 'tw') good.sort(function (a, b) { return b.tpk - a.tpk; });
      else good.sort(function (a, b) { return (a.tpk - b.tpk) || (b.km / b.h - a.km / a.h); });
      st.res = good.slice(0, 3);
      if (!st.res.length) st.msg = W('Aucun itinéraire trouvé (connexion internet ?). Réessaie dans un instant.', 'لم يُعثر على مسار (الإنترنت؟). أعد المحاولة بعد قليل.', 'No route found (internet connection?). Try again shortly.');
    } catch (e) { st.msg = window.mrErrTxt ? window.mrErrTxt(e, true) : (e.message || String(e)); } /* test-67 : message traduit */
    st.busy = false; st.prog = ''; draw();
  }
  /* villes traversées : un point tous les ~20 km (max 15), nom de la ville et de la wilaya */
  async function details(i) {
    var x = st.res[i]; if (!x || st.det[i]) return;
    st.det[i] = { busy: true, L: [], roads: '' }; draw();
    var k = cum(x.c), tot = k[k.length - 1], n = Math.min(15, Math.max(3, Math.round(tot / 20000))), L = [];
    for (var j = 0; j <= n; j++) {
      var tgt = tot * j / n, idx = 0; while (idx < k.length - 1 && k[idx] < tgt) idx++;
      var g = await reverse(x.c[idx], 10);
      if (g.t && (!L.length || L[L.length - 1].t != g.t)) L.push({ t: g.t, w: g.w, km: tgt / 1000, h: x.h * tgt / tot });
      st.det[i].L = L.slice(); draw();
      if (j < n) await sleep(1100);   // Nominatim : 1 requête par seconde
    }
    try {
      var ro = await osrm(x.wp, true), seen = {}, R2 = [];
      ro.legs.forEach(function (lg) { lg.steps.forEach(function (sp) { var r = (sp.ref || '').split(';')[0].trim(); if (r && sp.distance > 3000 && !seen[r]) { seen[r] = 1; R2.push(r); } }); });
      st.det[i].roads = R2.slice(0, 8).join(' · ');
    } catch (e) {}
    st.det[i].busy = false; draw();
  }

  /* ---------- affichage ---------- */
  function svg(c, s, v) {
    var Wd = 320, Ht = 190, pad = 14, xs = c.map(function (p) { return p[0]; }), ys = c.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var kx = Math.cos(rad((y0 + y1) / 2)), sc = Math.min((Wd - 2 * pad) / Math.max(1e-6, (x1 - x0) * kx), (Ht - 2 * pad) / Math.max(1e-6, y1 - y0));
    var ox = (Wd - (x1 - x0) * kx * sc) / 2, oy = (Ht - (y1 - y0) * sc) / 2;
    var P = function (p) { return [((p[0] - x0) * kx * sc + ox).toFixed(1), (Ht - ((p[1] - y0) * sc + oy)).toFixed(1)]; };
    var step = Math.max(1, Math.floor(c.length / 400)), pts = c.filter(function (p, i) { return i % step == 0; }).map(function (p) { return P(p).join(','); }).join(' ');
    var a = P(s), e = P(c[c.length - 1]), vv = v ? P(v) : null;
    return '<svg class="mp-svg" viewBox="0 0 ' + Wd + ' ' + Ht + '" role="img" aria-label="' + W('Tracé de l’itinéraire', 'مسار الطريق', 'Route track') + '" style="width:100%;height:auto;background:rgba(127,127,127,.08);border-radius:12px">' +
      '<polyline points="' + pts + '" fill="none" stroke="var(--acc)" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>' +
      (st.mode == 'one' && st.via ? '<circle cx="' + e[0] + '" cy="' + e[1] + '" r="7" fill="#d7263d" stroke="#fff" stroke-width="2.5"/>' : '') +
      (vv && st.mode == 'loop' ? '<circle cx="' + vv[0] + '" cy="' + vv[1] + '" r="6" fill="#d7263d" stroke="#fff" stroke-width="2.5"/>' : '') +
      '<circle cx="' + a[0] + '" cy="' + a[1] + '" r="7" fill="#0f9d6b" stroke="#fff" stroke-width="2.5"/></svg>';
  }
  var fmtH = function (h) { var m = Math.round(h * 60 / 5) * 5; return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0'); };
  var lvl = function (x) { return st.kind == 'op' ? (x.tpk < 0.25 ? '🛣️🛣️🛣️' : x.tpk < 0.5 ? '🛣️🛣️' : '🛣️') : x.tpk >= 1.2 ? '🌀🌀🌀' : x.tpk >= 0.5 ? '🌀🌀' : '🌀'; };
  var lvlTxt = function (x) { if (st.kind == 'op') return x.tpk < 0.25 ? W('très dégagée', 'مفتوحة جدا', 'very open') : x.tpk < 0.5 ? W('dégagée', 'مفتوحة', 'open') : W('quelques virages', 'بعض المنعرجات', 'some bends'); return x.tpk >= 1.2 ? W('très sinueux', 'كثير المنعرجات', 'very twisty') : x.tpk >= 0.5 ? W('sinueux', 'متعرّج', 'twisty') : W('peu de virages', 'منعرجات قليلة', 'few bends'); };
  function gmaps(x) {
    var f = function (p) { return p[1].toFixed(5) + ',' + p[0].toFixed(5); }, wp = x.wp, o = wp[0], d = wp[wp.length - 1];
    var mid = wp.slice(1, -1);
    if (!mid.length || (!st.via && mid.length < 3)) mid = [at(x.c, .25), at(x.c, .5), at(x.c, .75)];
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + f(o) + '&destination=' + f(d) + '&waypoints=' + encodeURIComponent(mid.slice(0, 3).map(f).join('|'));
  }
  function summary(x, i) {
    var dt = st.det[i], towns = dt && dt.L && dt.L.length ? '\n🏙️ ' + dt.L.map(function (t) { return t.t; }).join(' → ') : '';
    return (st.kind == 'op' ? '🛣️ ' : '🌀 ') + W('Proposition d’itinéraire MotoRoute', 'اقتراح مسار MotoRoute', 'MotoRoute route idea') +
      (st.place ? ' — ' + W('départ ', 'الانطلاق ', 'from ') + st.place : '') + (st.via ? ' — ' + W('par ', 'عبر ', 'via ') + st.via.name.split(',')[0] : '') +
      '\n' + Math.round(x.km) + ' km · ≈ ' + fmtH(x.h) + ' · ' + Math.round(x.km / x.h) + ' km/h ' + W('de moyenne', 'كمعدل', 'average') + ' · ' + x.t + ' ' + W('virages', 'منعرجا', 'bends') + ' (' + lvlTxt(x) + ')' +
      towns + '\n🧭 ' + gmaps(x);
  }
  var chip = function (on, attr, val, label) { return '<button class="' + (on ? 'p' : 'g') + '" ' + attr + '="' + val + '">' + label + '</button>'; };
  function card() {
    var h = '<div class="card" id="mrItCard"><div class="row" style="margin-top:0;justify-content:space-between;align-items:center"><h3 style="margin:0">🌀 ' + W('Proposer un itinéraire', 'اقتراح مسار', 'Suggest a route') + '</h3><button class="g" data-itopen="1">' + (st.open ? '▴' : W('Ouvrir ▾', 'فتح ▾', 'Open ▾')) + '</button></div>' +
      '<div class="meta">' + W('Tu sors la moto sans savoir où aller ? Dis-nous quel genre de route tu veux, et si tu veux passer par une ville : MotoRoute te propose des itinéraires.', 'تخرج الدراجة ولا تعرف إلى أين؟ اختر نوع الطريق، ومدينة تمرّ بها إن أردت: يقترح عليك MotoRoute مسارات.', 'Taking the bike out with nowhere in mind? Pick the kind of road and, if you like, a town to ride through: MotoRoute suggests routes.') + '</div>';
    if (!st.open) return h + '</div>';
    var G = 'class="row" style="justify-content:flex-start;gap:6px;flex-wrap:wrap"', T = function (t) { return '<div class="meta" style="margin-top:10px"><b>' + t + '</b></div>'; };
    h += T(W('1. Quel genre de route ?', '1. أي نوع من الطرق؟', '1. What kind of road?')) + '<div ' + G + '>' +
      chip(st.kind == 'tw', 'data-itk', 'tw', '🌀 ' + W('Sinueuse, avec virages', 'متعرّجة، بمنعرجات', 'Twisty, with bends')) +
      chip(st.kind == 'op', 'data-itk', 'op', '🛣️ ' + W('Dégagée (autoroute, nationale, lignes droites)', 'مفتوحة (طريق سريع، وطني، خطوط مستقيمة)', 'Open (motorway, main roads, straights)')) + '</div>' +
      T(W('2. Passer par une ville ? (facultatif)', '2. المرور بمدينة؟ (اختياري)', '2. Ride through a town? (optional)')) +
      '<input id="mrItCity" value="' + esc(st.city) + '" placeholder="' + W('Ex. Mostaganem, Tikjda, Béjaïa…', 'مثال: مستغانم، تيكجدة، بجاية…', 'E.g. Mostaganem, Tikjda, Béjaïa…') + '" autocomplete="off" style="width:100%;box-sizing:border-box">' +
      T(W('3. Retour chez moi ?', '3. العودة إلى المنزل؟', '3. Back home?')) + '<div ' + G + '>' +
      chip(st.mode == 'loop', 'data-itm', 'loop', '🔁 ' + W('Boucle : retour au départ', 'حلقة: العودة إلى الانطلاق', 'Loop: back to start')) +
      chip(st.mode == 'one', 'data-itm', 'one', '➡️ ' + W('Aller simple jusqu’à la ville', 'ذهاب فقط إلى المدينة', 'One way to the town')) + '</div>' +
      (st.mode == 'one' && !String(st.city).trim() ? '<div class="meta">' + W('Pour un aller simple, écris la ville d’arrivée ci-dessus.', 'للذهاب فقط، اكتب مدينة الوصول أعلاه.', 'For one way, type the destination town above.') + '</div>' : '') +
      (String(st.city).trim() ? '<div class="meta" style="margin-top:10px">⏱️ ' + W('La durée dépend de la ville choisie : elle s’affichera dans les propositions.', 'المدة تتعلق بالمدينة المختارة: ستظهر في الاقتراحات.', 'Duration depends on the town: it will show in the suggestions.') + '</div>' :
        T(W('4. Combien de temps as-tu ?', '4. كم لديك من الوقت؟', '4. How much time do you have?')) + '<div ' + G + '>' +
        DURS.map(function (v) { return chip(st.dur == v, 'data-itd', v, v == 8 ? W('Journée', 'يوم كامل', 'Full day') : v < 1 ? '30 min' : v % 1 ? Math.floor(v) + ' h 30' : v + ' h'); }).join('') + '</div>') +
      '<div class="row"><button class="p" data-itgo="1" ' + (st.busy ? 'disabled' : '') + '>📍 ' + W('Proposer depuis ma position', 'اقترح من موقعي', 'Suggest from my position') + '</button></div>';
    if (st.prog) h += '<div class="meta">⏳ ' + esc(st.prog) + '</div>';
    if (st.msg) h += '<div class="meta" style="color:#d7263d">' + esc(st.msg) + '</div>';
    if (st.res.length && st.via) h += '<div class="meta" style="margin-top:8px">📍 ' + W('Par : ', 'عبر: ', 'Via: ') + '<b>' + esc(st.via.name) + '</b></div>';
    st.res.forEach(function (x, i) {
      var dt = st.det[i];
      h += '<div style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px"><div class="row" style="margin-top:0;justify-content:space-between"><b>' + W('Proposition ', 'اقتراح ', 'Idea ') + (i + 1) + ' ' + lvl(x) + '</b><span class="tag">' + lvlTxt(x) + '</span></div>' +
        svg(x.c, st.start, st.via && st.via.p) +
        '<div class="meta"><b>' + Math.round(x.km) + ' km</b> · ≈ <b>' + fmtH(x.h) + '</b> ' + W('sans les pauses', 'دون التوقفات', 'without stops') + ' · <b>' + Math.round(x.km / x.h) + ' km/h</b> ' + W('de moyenne', 'كمعدل', 'average') + ' · <b>' + x.t + '</b> ' + W('virages', 'منعرجا', 'bends') + '</div>';
      if (dt) {
        h += '<div class="meta" style="margin-top:6px"><b>🏙️ ' + W('Villes traversées', 'المدن التي تمرّ بها', 'Towns on the way') + '</b>' + (dt.busy ? ' ⏳' : '') + '</div>' +
          dt.L.map(function (t) { return '<div class="meta">• <b>' + esc(t.t) + '</b>' + (t.w ? ' <span style="opacity:.7">(' + esc(t.w) + ')</span>' : '') + ' — ' + Math.round(t.km) + ' km · ' + W('vers ', 'بعد ', 'after ') + fmtH(t.h) + W(' de route', ' من الطريق', ' riding') + '</div>'; }).join('') +
          (dt.roads ? '<div class="meta">🛣️ ' + W('Routes principales : ', 'الطرق الرئيسية: ', 'Main roads: ') + esc(dt.roads) + '</div>' : '');
      }
      h += '<div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap">' +
        (dt ? '' : '<button class="g" data-itdet="' + i + '">🏙️ ' + W('Villes traversées', 'المدن التي تمرّ بها', 'Towns on the way') + '</button>') +
        '<a class="lnk" target="_blank" rel="noopener" href="' + esc(gmaps(x)) + '">🧭 ' + W('Partir (Google Maps)', 'انطلق (Google Maps)', 'Go (Google Maps)') + '</a>' +
        '<button class="g" data-itgpx="' + i + '">⬇ GPX</button>' +
        '<a class="lnk" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(summary(x, i)) + '">💬 WhatsApp</a>' +
        '<button class="g" data-itgrp="' + i + '">📣 ' + W('Proposer à mon groupe', 'اقترح على مجموعتي', 'Suggest to my group') + '</button></div>' +
        (st.grp && st.grp.i == i ? grpPicker() : '') + '</div>';
    });
    if (st.res.length) h += '<div class="meta" style="margin-top:8px">ℹ️ ' + W('Durée estimée pour une conduite tranquille, sans les pauses. Google Maps peut prendre quelques routes différentes entre les points de passage : le fichier GPX garde le tracé exact (à ouvrir dans OsmAnd, Calimoto ou Kurviger).', 'المدة تقديرية لقيادة هادئة دون توقف. قد يختار Google Maps بعض الطرق المختلفة بين النقاط: ملف GPX يحفظ المسار الدقيق.', 'Estimated for relaxed riding, without stops. Google Maps may pick slightly different roads between waypoints: the GPX file keeps the exact track.') + '</div>';
    return h + '</div>';
  }
  function myGroups() { try { return (S.groups || []).filter(function (g) { return g.srv && g.uid && g.me; }); } catch (e) { return []; } }
  function grpPicker() {
    var G = myGroups();
    if (!G.length) return '<div class="meta" style="color:#d7263d">' + W('Rejoins d’abord un groupe (onglet Groupes) pour y proposer un itinéraire.', 'انضم أولا إلى مجموعة (تبويب المجموعات) لتقترح فيها مسارا.', 'Join a group first (Groups tab) to suggest a route there.') + '</div>';
    return '<div class="row" style="justify-content:flex-start;gap:6px;flex-wrap:wrap">' + G.map(function (g) { return '<button class="g" data-itsend="' + esc(g.uid) + '">' + esc(g.name) + '</button>'; }).join('') + '</div>' +
      (st.grp.msg ? '<div class="meta">' + esc(st.grp.msg) + '</div>' : '');
  }
  function draw() {
    var el = document.getElementById('mrItCard'); if (!el) return;
    var inp = document.getElementById('mrItCity'), foc = inp && document.activeElement === inp;
    if (inp) st.city = inp.value;
    el.outerHTML = card();
    if (foc) { var n = document.getElementById('mrItCity'); if (n) { n.focus(); try { n.setSelectionRange(n.value.length, n.value.length); } catch (e) {} } }
  }

  async function sendToGroup(uid) {
    var i = st.grp.i, x = st.res[i], sb = window.mrSb, u = window.mrUser && window.mrUser();
    if (!sb || !u) { st.grp.msg = W('Connecte-toi d’abord.', 'سجّل الدخول أولا.', 'Log in first.'); return draw(); }
    st.grp.msg = '⏳'; draw();
    try {
      var fn = ''; try { var p = await sb.from('profiles').select('first_name').eq('id', u.id).maybeSingle(); fn = (p.data && p.data.first_name) || ''; } catch (e) {}
      var body = summary(x, i); if (body.length > 500) body = summary(x, -1);   // sans la liste des villes si trop long
      var r = await sb.from('group_messages').insert({ group_id: uid, user_id: u.id, first_name: fn, body: body.slice(0, 500) });
      if (r.error) throw r.error;
      st.grp.msg = '✅ ' + W('Envoyé dans la discussion du groupe.', 'أُرسل في دردشة المجموعة.', 'Sent to the group chat.');
    } catch (e) { st.grp.msg = '⚠️ ' + (window.mrErrTxt ? window.mrErrTxt(e) : ((e && e.message) || String(e))); }
    draw();
  }

  /* ---------- branchement ---------- */
  /* pendant la saisie de la ville : on retient le texte, et on redessine (durées / aide) seulement après une pause,
     jamais au moment où le champ perd le focus (sinon le bouton touché juste après est redessiné et le toucher est perdu) */
  var tIn = null, hadCity = false;
  document.addEventListener('input', function (e) {
    if (!e.target || e.target.id != 'mrItCity') return;
    st.city = e.target.value; clearTimeout(tIn);
    var has = !!st.city.trim();
    if (has != hadCity) tIn = setTimeout(function () { hadCity = has; if (document.activeElement && document.activeElement.id == 'mrItCity') draw(); }, 700);
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-itd],[data-itk],[data-itm],[data-itopen],[data-itgo],[data-itdet],[data-itgpx],[data-itgrp],[data-itsend]'); if (!b) return;
    var D = b.dataset, inp = document.getElementById('mrItCity'); if (inp) st.city = inp.value;
    if (D.itd) { st.dur = +D.itd; draw(); }
    else if (D.itk) { if (st.kind != D.itk) { st.kind = D.itk; st.res = []; st.grp = null; st.det = {}; } draw(); }
    else if (D.itm) { if (st.mode != D.itm) { st.mode = D.itm; st.res = []; st.grp = null; st.det = {}; } draw(); }
    else if (D.itopen) { st.open = !st.open; draw(); }
    else if (D.itgo) { if (st.mode == 'one' && !String(st.city).trim()) { st.msg = W('Écris la ville d’arrivée.', 'اكتب مدينة الوصول.', 'Type the destination town.'); return draw(); } search(); }
    else if (D.itdet) details(+D.itdet);
    else if (D.itgpx) {
      var x = st.res[+D.itgpx]; if (!x || !window.mrShareGpxText) return;
      var nm = 'MotoRoute ' + Math.round(x.km) + ' km' + (st.via ? ' ' + st.via.name.split(',')[0] : '');
      var txt = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MotoRoute" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>' + esc(nm) + '</name></metadata>\n<trk><name>' + esc(nm) + '</name><trkseg>\n' +
        x.c.map(function (p) { return '<trkpt lat="' + p[1].toFixed(6) + '" lon="' + p[0].toFixed(6) + '"></trkpt>'; }).join('\n') + '\n</trkseg></trk>\n</gpx>\n';
      window.mrShareGpxText(txt, 'motoroute-' + Math.round(x.km) + 'km-' + Date.now() + '.gpx');
    }
    else if (D.itgrp) { var i = +D.itgrp; st.grp = st.grp && st.grp.i == i ? null : { i: i, msg: '' }; draw(); }
    else if (D.itsend) sendToGroup(D.itsend);
  });
  /* en tête de l'onglet Sorties (demande d'Elaid, 24/10) */
  try {
    if (typeof render == 'function') {
      var _rd = render;
      render = function () { var r = _rd.apply(this, arguments); try { if (tab == 1) { var m = document.getElementById('main'); if (m && !document.getElementById('mrItCard')) m.insertAdjacentHTML('afterbegin', card()); } } catch (e) {} return r; };
    }
  } catch (e) {}
  /* pour les essais */
  window.mrItin = { turns: turns, backtrack: backtrack, st: st, draw: draw };
})();
