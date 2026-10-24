/* MotoRoute test-54 : ce qui manquait face aux concurrents (analyse du 24/10/2026)
   1. Naviguer vers une sortie dans Google Maps ou Waze (itinéraire départ → arrivée)
   2. Exporter un trajet enregistré en GPX (pour Calimoto, Kurviger, OsmAnd, Google My Maps…)
   3. Mesurer la batterie consommée pendant un trajet (Conduite)
   4. Bouton « Contacter MotoRoute » (WhatsApp) */
(function () {
  var LG = function () { try { return lang; } catch (e) { return 'fr'; } };
  var W = function (f, a, e) { var l = LG(); return l == 'ar' ? a : l == 'en' ? e : f; };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* ---------- 1. Navigation ---------- */
  window.mrNavLinks = function (s) {
    var tbd = ''; try { tbd = T().tbd; } catch (e) {}
    var ok = function (v) { return v && String(v).trim() && v != tbd && v != '?'; };
    if (!ok(s.dest)) return '';
    var g = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(s.dest) + '&travelmode=driving' + (ok(s.dep) ? '&origin=' + encodeURIComponent(s.dep) : '');
    var w = 'https://waze.com/ul?q=' + encodeURIComponent(s.dest) + '&navigate=yes';
    return '<a class="lnk" target="_blank" rel="noopener" href="' + esc(g) + '">🧭 ' + W('Itinéraire Google Maps', 'مسار Google Maps', 'Google Maps route') + '</a>' +
           '<a class="lnk" target="_blank" rel="noopener" href="' + esc(w) + '">🚙 Waze</a>';
  };

  /* ---------- 2. Export GPX ---------- */
  function gpxText(r) {
    var t0 = +r.id || Date.now();
    var pts = r.tk.map(function (p) {
      return '<trkpt lat="' + p[0] + '" lon="' + p[1] + '">' +
        (p[6] != null ? '<ele>' + p[6] + '</ele>' : '') +
        (p[5] != null ? '<time>' + new Date(t0 + p[5] * 1000).toISOString() + '</time>' : '') + '</trkpt>';
    }).join('\n');
    var nm = 'MotoRoute ' + r.d + ' – ' + r.km + ' km';
    return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MotoRoute" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      '<metadata><name>' + esc(nm) + '</name></metadata>\n<trk><name>' + esc(nm) + '</name><trkseg>\n' + pts + '\n</trkseg></trk>\n</gpx>\n';
  }
  async function shareGpx(r) {
    var txt = gpxText(r), name = 'motoroute-' + r.d + '-' + r.id + '.gpx';
    var P = window.Capacitor && Capacitor.Plugins;
    if (P && P.Filesystem && P.Share) {
      try {
        var f = await P.Filesystem.writeFile({ path: name, data: txt, directory: 'CACHE', encoding: 'utf8' });
        await P.Share.share({ title: name, dialogTitle: W('Envoyer le trajet GPX', 'إرسال المسار GPX', 'Send GPX track'), files: [f.uri] });
        return;
      } catch (e) { if (e && /cancel/i.test(String(e.message || e))) return; }
    }
    try {
      var file = new File([txt], name, { type: 'application/gpx+xml' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    } catch (e) { if (e && e.name == 'AbortError') return; }
    var u = URL.createObjectURL(new Blob([txt], { type: 'application/gpx+xml' })), a = document.createElement('a');
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-gpxx]'); if (!b) return;
    var id = b.getAttribute('data-gpxx'), r = ((typeof S != 'undefined' && S.rides) || []).find(function (x) { return String(x.id) == id; });
    if (!r || !r.tk || r.tk.length < 2) { alert(W('Ce trajet n’a pas de tracé GPS.', 'هذه الرحلة بدون مسار GPS.', 'This trip has no GPS track.')); return; }
    shareGpx(r);
  });

  /* ---------- 3. Batterie pendant un trajet ---------- */
  var b0 = null;
  window.mrBatStart = function () {
    b0 = null;
    if (!navigator.getBattery) return;
    navigator.getBattery().then(function (b) { b0 = { l: b.level, t: Date.now(), c: b.charging }; }).catch(function () {});
  };
  window.mrBatEnd = function (r, done) {
    var s0 = b0; b0 = null;
    if (!s0 || s0.c || !navigator.getBattery || !r) return;
    navigator.getBattery().then(function (b) {
      if (b.charging) return;
      var d = Math.round((s0.l - b.level) * 100), h = (Date.now() - s0.t) / 36e5;
      if (d < 0) return;
      r.bat = { d: d, h: h >= 0.25 ? Math.round(d / h) : null };
      done && done();
    }).catch(function () {});
  };

  /* ---------- 4. Contacter MotoRoute ---------- */
  window.MR_SUPPORT_WA = window.MR_SUPPORT_WA || '213561609454'; // 0561 60 94 54 (Elaid)
  window.mrSupportHtml = function () {
    var n = String(window.MR_SUPPORT_WA || '').replace(/\D/g, '');
    if (!n) return '';
    var v = ''; try { v = window.MR_VERSION || ''; } catch (e) {}
    var msg = W('Bonjour MotoRoute, ', 'مرحبا MotoRoute، ', 'Hello MotoRoute, ') + '(' + 'v ' + v + ')';
    return '<a class="lnk" target="_blank" rel="noopener" href="https://wa.me/' + n + '?text=' + encodeURIComponent(msg) + '">💬 ' + W('Contacter MotoRoute', 'تواصل مع MotoRoute', 'Contact MotoRoute') + '</a>';
  };
})();
/* Bouton « Contacter MotoRoute » en bas de l'onglet Route (visible quand le numéro est rempli) */
(function () {
  try {
    if (typeof routeView != 'function') return;
    var _rv = routeView;
    routeView = function (t) { var h = _rv(t), s = window.mrSupportHtml ? window.mrSupportHtml() : ''; return s ? h + '<div class="card"><div class="row" style="justify-content:center">' + s + '</div></div>' : h; };
  } catch (e) {}
})();
