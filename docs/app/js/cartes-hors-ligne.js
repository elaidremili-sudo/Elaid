/* MotoRoute — cartes hors ligne (05/11/2026)
   Carte vectorielle MapLibre + données Protomaps (OpenStreetMap) au format PMTiles, hébergées par MotoRoute.
   - Tout ce qu'il faut pour dessiner la carte est DANS l'appli : bibliothèque, style, polices latin + arabe, icônes.
   - Les tuiles affichées sont gardées sur le téléphone ; « Télécharger autour de moi » range toute une zone
     (rayon au choix) pour la montagne ou le sud sans réseau. Les tuiles vectorielles z14-15 restent nettes
     jusqu'au zoom 18 (sur-zoom), environ 10 fois plus légères que des images.
   - Données : © OpenStreetMap (ODbL), tuiles Protomaps ; l'attribution reste visible sur la carte.
   - Si le fichier de carte n'est pas encore en ligne (MR_PMTILES vide) ou si la carte ne peut pas démarrer,
     l'appli garde l'ancien aperçu en ligne : rien ne casse.
   API : window.MrMaps.{ready(), mount(el, lat, lng, acc), move(lat, lng, acc), unmount(), zones(), download(o),
         remove(id), plan(km, zmax), managerHtml(), bindManager(root)} */
(function () {
  'use strict';
  // Adresse du fichier de carte (Cloudflare R2, accès public, CORS https://localhost + GitHub Pages).
  // MR_PMTILES : une adresse, ou une liste de morceaux [{url, bbox:[ouest, sud, est, nord]}] (fichier découpé
  // pour rester sous la limite d'envoi de Cloudflare). Pour une tuile, on prend le 1er morceau qui la touche :
  // chaque morceau contient en entier toutes les tuiles qui touchent sa zone.
  var PARTS = (function (v) {
    if (!v) return [];
    if (typeof v === 'string') return [{ url: v, bbox: [-180, -85, 180, 85] }];
    return (Array.isArray(v) ? v : []).filter(function (p) { return p && p.url && p.bbox && p.bbox.length === 4; });
  })(window.MR_PMTILES);
  var PM_URL = PARTS.length ? PARTS[0].url : '';
  var SRC_MAX = 14, DL_MAX = 14, MAX_TILES = 20000, CONC = 6, AVG_KB = 9;
  var DB = 'mr_cartes', T = 'tiles', Z = 'zones', V = 'vues', MAX_SEEN = 3000;
  var LIB = function (p) { return new URL('lib/carte/' + p, location.href).href; };
  var ATTR = '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> © <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

  var lg = function () { try { return typeof lang !== 'undefined' ? lang : 'fr'; } catch (e) { return 'fr'; } };
  var W = function (f, a, e) { var l = lg(); return l === 'ar' ? a : l === 'en' ? e : f; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /* ---------- stockage IndexedDB ---------- */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 3);
      r.onupgradeneeded = function (ev) { var d = r.result;
        if (ev.oldVersion < 2) { if (d.objectStoreNames.contains(T)) d.deleteObjectStore(T); d.createObjectStore(T); }
        if (!d.objectStoreNames.contains(Z)) d.createObjectStore(Z, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(V)) d.createObjectStore(V).createIndex('at', 'at'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function req(store, mode, fn) {
    return db().then(function (d) { return new Promise(function (res, rej) {
      var t = d.transaction(store, mode), out = fn(t.objectStore(store));
      t.oncomplete = function () { res(out instanceof IDBRequest ? out.result : out); };
      t.onerror = t.onabort = function () { rej(t.error); };
    }); });
  }
  var tkey = function (z, x, y) { return z + '/' + x + '/' + y; };
  var getTile = function (z, x, y) { return req(T, 'readonly', function (s) { return s.get(tkey(z, x, y)); }); };
  var putTile = function (z, x, y, buf) { return req(T, 'readwrite', function (s) { s.put(buf, tkey(z, x, y)); }); };

  /* Tuiles seulement VUES (hors zones téléchargées) : on en garde 3 000 au plus, les plus anciennes partent.
     Sinon la liste des tuiles finirait par retracer tous les lieux où le motard est passé. */
  var nSeen = 0;
  function seen(z, x, y) {
    return req(V, 'readwrite', function (s) { s.put({ at: Date.now() }, tkey(z, x, y)); }).then(function () {
      if (++nSeen % 100) return;
      return zones().then(function (all) {
        var inZone = function (k) { var p = k.split('/').map(Number); return all.some(function (zn) { return p[0] <= zn.zmax &&
          p[1] >= lon2x(zn.bb[1], p[0]) && p[1] <= lon2x(zn.bb[3], p[0]) && p[2] >= lat2y(zn.bb[2], p[0]) && p[2] <= lat2y(zn.bb[0], p[0]); }); };
        return db().then(function (d) { return new Promise(function (res) {
          var t = d.transaction([V, T], 'readwrite'), sv = t.objectStore(V), st = t.objectStore(T), c = sv.count();
          c.onsuccess = function () {
            var extra = c.result - MAX_SEEN; if (extra <= 0) return;
            sv.index('at').openCursor().onsuccess = function (ev) {
              var cur = ev.target.result; if (!cur || extra-- <= 0) return;
              if (!inZone(cur.primaryKey)) st.delete(cur.primaryKey);
              cur.delete(); cur.continue();
            };
          };
          t.oncomplete = t.onerror = t.onabort = function () { res(); };
        }); });
      });
    }).catch(function () {});
  }
  function clearSeen() {
    return zones().then(function (all) {
      var inZone = function (k) { var p = String(k).split('/').map(Number); return all.some(function (zn) { return p[0] <= zn.zmax &&
        p[1] >= lon2x(zn.bb[1], p[0]) && p[1] <= lon2x(zn.bb[3], p[0]) && p[2] >= lat2y(zn.bb[2], p[0]) && p[2] <= lat2y(zn.bb[0], p[0]); }); };
      return db().then(function (d) { return new Promise(function (res) {
        var t = d.transaction([V, T], 'readwrite'), sv = t.objectStore(V), st = t.objectStore(T);
        sv.openCursor().onsuccess = function (ev) { var c = ev.target.result; if (!c) return; if (!inZone(c.primaryKey)) st.delete(c.primaryKey); c.delete(); c.continue(); };
        t.oncomplete = t.onerror = t.onabort = function () { res(); };
      }); });
    }).catch(function () {});
  }

  /* ---------- géométrie des tuiles ---------- */
  function lon2x(lon, z) { return Math.max(0, Math.min(Math.pow(2, z) - 1, Math.floor((lon + 180) / 360 * Math.pow(2, z)))); }
  function lat2y(lat, z) { var r = lat * Math.PI / 180; return Math.max(0, Math.min(Math.pow(2, z) - 1, Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)))); }
  function bboxOf(lat, lng, km) { var dLat = km / 111.32, dLng = km / (111.32 * Math.cos(lat * Math.PI / 180)); return [lat - dLat, lng - dLng, lat + dLat, lng + dLng]; }
  function tilesFor(bb, zmin, zmax) {
    var out = [];
    for (var z = zmin; z <= zmax; z++) {
      var x0 = lon2x(bb[1], z), x1 = lon2x(bb[3], z), y0 = lat2y(bb[2], z), y1 = lat2y(bb[0], z);
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) out.push([z, x, y]);
    }
    return out;
  }
  function plan(km, zmax, lat) {
    var n = tilesFor(bboxOf(lat || 36, 3, km), 0, Math.min(zmax || 14, DL_MAX)).length;
    return { tiles: n, mb: Math.max(1, Math.round(n * AVG_KB / 1024)) };
  }

  /* ---------- chargement des bibliothèques embarquées ---------- */
  function script(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  var libp = null;
  function tileBox(z, x, y) { var n = Math.pow(2, z), lon = function (v) { return v / n * 360 - 180; },
      lat = function (v) { var r = Math.PI - 2 * Math.PI * v / n; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(r) - Math.exp(-r))); };
    return [lon(x), lat(y + 1), lon(x + 1), lat(y)]; }
  function pmFor(z, x, y) {
    var b = tileBox(z, x, y);
    for (var i = 0; i < PARTS.length; i++) { var q = PARTS[i].bbox;
      if (b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]) {
        if (!PARTS[i].pm) PARTS[i].pm = new window.pmtiles.PMTiles(PARTS[i].url); return PARTS[i].pm; } }
    return null;
  }
  function libs() {
    if (libp) return libp;
    var c = document.createElement('link'); c.rel = 'stylesheet'; c.href = LIB('maplibre-gl.css'); document.head.appendChild(c);
    libp = Promise.all([script(LIB('maplibre-gl.js')), script(LIB('pmtiles.js')), script(LIB('basemaps.js'))]).then(function () {
      var ml = window.maplibregl;
      try { if (ml.getRTLTextPluginStatus && ml.getRTLTextPluginStatus() === 'unavailable') { var rp = ml.setRTLTextPlugin(LIB('rtl-text.js'), true); if (rp && rp.catch) rp.catch(function () {}); } } catch (e) {}
      // Tuiles : téléphone d'abord, réseau ensuite (et on garde ce qui a été vu).
      ml.addProtocol('mrpm', function (p) {
        var m = /mrpm:\/\/(\d+)\/(\d+)\/(\d+)/.exec(p.url); if (!m) return Promise.reject(new Error('url'));
        var z = +m[1], x = +m[2], y = +m[3];
        return getTile(z, x, y).catch(function () { return null; }).then(function (have) {
          if (have) return { data: have };
          var pm = pmFor(z, x, y);
          if (!pm || navigator.onLine === false) return { data: new ArrayBuffer(0) };
          return pm.getZxy(z, x, y).then(function (r) {
            var d = r && r.data ? r.data : new ArrayBuffer(0);
            putTile(z, x, y, d).then(function () { return seen(z, x, y); }).catch(function () {});
            return { data: d };
          }, function () { return { data: new ArrayBuffer(0) }; });
        });
      });
      // Polices embarquées ; une plage absente renvoie un jeu vide (pas d'erreur, pas de réseau).
      ml.addProtocol('mrglyph', function (p) {
        var m = /mrglyph:\/\/([^/]+)\/(\d+-\d+)/.exec(p.url); if (!m) return Promise.resolve({ data: new ArrayBuffer(0) });
        var stack = decodeURIComponent(m[1]).split(',')[0].trim();
        return fetch(LIB('fonts/' + encodeURIComponent(stack) + '/' + m[2] + '.pbf')).then(function (r) { return r.ok ? r.arrayBuffer() : new ArrayBuffer(0); })
          .then(function (b) { return { data: b }; }, function () { return { data: new ArrayBuffer(0) }; });
      });
      return ml;
    });
    libp.catch(function () { libp = null; });
    return libp;
  }
  function style() {
    var B = window.basemaps, l = lg() === 'ar' ? 'ar' : lg() === 'en' ? 'en' : 'fr';
    return { version: 8, glyphs: 'mrglyph://{fontstack}/{range}', sprite: LIB('sprites/dark'),
      sources: { pm: { type: 'vector', tiles: ['mrpm://{z}/{x}/{y}'], minzoom: 0, maxzoom: SRC_MAX, attribution: ATTR } },
      layers: B.layers('pm', B.namedFlavor('dark'), { lang: l }) };
  }

  /* ---------- carte affichée ---------- */
  var M = null, mk = null, follow = true, last = null;
  function circle(lat, lng, m) {
    var pts = [], n = 40, dLat = m / 111320, dLng = m / (111320 * Math.cos(lat * Math.PI / 180));
    for (var i = 0; i <= n; i++) { var a = i / n * 2 * Math.PI; pts.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]); }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} };
  }
  function mount(el, lat, lng, acc) {
    if (!el || !PM_URL) return Promise.reject(new Error('nomap'));
    return libs().then(function (ml) {
      if (M && M.getContainer() === el) { move(lat, lng, acc); return M; }
      if (M && !document.body.contains(M.getContainer())) {
        // l'écran a été redessiné : on remet la même carte à la place du nouveau cadre (pas de clignotement, zoom gardé)
        el.replaceWith(M.getContainer()); try { M.resize(); } catch (e) {}
        if (last) move(last[0], last[1], last[2]); return M;
      }
      unmount();
      M = new ml.Map({ container: el, style: style(), center: [lng, lat], zoom: 14, maxZoom: 18, attributionControl: { compact: false }, pitchWithRotate: false, dragRotate: false });
      M.touchZoomRotate.disableRotation();
      M.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      var dot = document.createElement('div');
      dot.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#ff7a1a;border:3px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.35)';
      mk = new ml.Marker({ element: dot }).setLngLat([lng, lat]).addTo(M);
      M.on('load', function () {
        M.addSource('mr_acc', { type: 'geojson', data: circle(lat, lng, acc || 30) });
        M.addLayer({ id: 'mr_acc', type: 'fill', source: 'mr_acc', paint: { 'fill-color': '#ff7a1a', 'fill-opacity': 0.15 } });
      });
      M.on('dragstart', function () { follow = false; });
      var btn = document.createElement('button'); btn.type = 'button'; btn.textContent = '◎'; btn.setAttribute('aria-label', W('Recentrer sur moi', 'إعادة التمركز', 'Recenter on me'));
      btn.style.cssText = 'position:absolute;right:10px;bottom:34px;z-index:2;width:40px;height:40px;border-radius:10px;border:0;background:#fff;color:#111;font-size:20px;box-shadow:0 1px 4px rgba(0,0,0,.4)';
      btn.onclick = function () { follow = true; if (last) M.easeTo({ center: [last[1], last[0]], zoom: Math.max(M.getZoom(), 14) }); };
      el.appendChild(btn);
      if (!last) last = [lat, lng, acc]; else move(last[0], last[1], last[2]);
      return M;
    });
  }
  function move(lat, lng, acc) {
    last = [lat, lng, acc]; if (!M || !mk) return;
    mk.setLngLat([lng, lat]);
    try { var s = M.getSource('mr_acc'); if (s) s.setData(circle(lat, lng, acc || 30)); } catch (e) {}
    if (follow) M.jumpTo({ center: [lng, lat] });
  }
  function unmount() { try { if (M) M.remove(); } catch (e) {} M = mk = null; follow = true; }
  // retour du réseau : les endroits restés vides sont redemandés
  window.addEventListener('online', function () { try { if (M && M.style && M.style.sourceCaches && M.style.sourceCaches.pm) M.style.sourceCaches.pm.reload(); } catch (e) {} });

  /* ---------- zones téléchargées ---------- */
  var zones = function () { return req(Z, 'readonly', function (s) { return s.getAll(); }).catch(function () { return []; }); };
  var job = null;
  function download(o) {
    if (job) return Promise.reject(new Error('busy'));
    if (!PM_URL) return Promise.reject(new Error('nomap'));
    var km = Math.min(Math.max(+o.km || 30, 5), 100), zmax = Math.min(+o.zmax || 14, DL_MAX);
    var bb = bboxOf(o.lat, o.lng, km), list = tilesFor(bb, 0, zmax);
    if (list.length > MAX_TILES) return Promise.reject(new Error('toobig'));
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
    var zone = { id: 'z' + Date.now(), name: String(o.name || '').trim().slice(0, 60) || W('Zone', 'منطقة', 'Area'),
      lat: o.lat, lng: o.lng, km: km, bb: bb, zmax: zmax, n: list.length, bytes: 0, at: Date.now(), done: false };
    var stop = false; job = { cancel: function () { stop = true; }, onProgress: o.onProgress, zone: zone };
    return libs().then(function () {
      var i = 0, ok = 0, bytes = 0, errs = 0;
      function one() {
        if (stop || i >= list.length) return Promise.resolve();
        var t = list[i++];
        return getTile(t[0], t[1], t[2]).then(function (have) {
          if (have) { ok++; bytes += have.byteLength || 0; return; }
          var pm = pmFor(t[0], t[1], t[2]); if (!pm) { ok++; return putTile(t[0], t[1], t[2], new ArrayBuffer(0)); }
          return pm.getZxy(t[0], t[1], t[2]).then(function (r) {
            var d = r && r.data ? r.data : new ArrayBuffer(0); ok++; bytes += d.byteLength; return putTile(t[0], t[1], t[2], d);
          });
        }).catch(function () { errs++; }).then(function () {
          if (job && job.onProgress && (i % 20 === 0 || i >= list.length)) { try { job.onProgress(ok, list.length, bytes, errs); } catch (e) {} }
          return one();
        });
      }
      var w = []; for (var k = 0; k < CONC; k++) w.push(one());
      return Promise.all(w).then(function () {
        zone.bytes = bytes; zone.ok = ok; zone.errs = errs; zone.done = !stop && ok >= list.length * 0.98;
        return req(Z, 'readwrite', function (s) { s.put(zone); }).then(function () { return zone; });
      });
    }).then(function (z) { job = null; return z; }, function (e) { job = null; throw e; });
  }
  function remove(id) {
    return zones().then(function (all) {
      var gone = all.filter(function (z) { return z.id === id; })[0]; if (!gone) return;
      var keep = all.filter(function (z) { return z.id !== id; });
      var inKeep = function (t) { return keep.some(function (k) { if (t[0] > k.zmax) return false;
        return t[1] >= lon2x(k.bb[1], t[0]) && t[1] <= lon2x(k.bb[3], t[0]) && t[2] >= lat2y(k.bb[2], t[0]) && t[2] <= lat2y(k.bb[0], t[0]); }); };
      var del = tilesFor(gone.bb, 0, gone.zmax).filter(function (t) { return !inKeep(t); });
      return req(T, 'readwrite', function (s) { del.forEach(function (t) { s.delete(tkey(t[0], t[1], t[2])); }); })
        .then(function () { return req(Z, 'readwrite', function (s) { s.delete(id); }); });
    });
  }
  function usage() {
    try { return navigator.storage && navigator.storage.estimate ? navigator.storage.estimate() : Promise.resolve(null); } catch (e) { return Promise.resolve(null); }
  }

  /* ---------- écran de gestion ---------- */
  var mo = function (b) { return (b >= 1048576 ? (Math.round(b / 104857.6) / 10) + ' Mo' : Math.max(1, Math.round(b / 1024)) + ' Ko'); };
  function managerHtml() {
    if (!PM_URL) return '<div class="meta">' + W('Les cartes hors ligne MotoRoute arrivent bientôt. En attendant : Google Maps → ton profil → Cartes hors connexion → choisis ta zone.',
      'خرائط MotoRoute دون اتصال قريبًا. في الأثناء: خرائط Google ← ملفك ← الخرائط بلا اتصال ← اختر منطقتك.',
      'MotoRoute offline maps are coming soon. Meanwhile: Google Maps → your profile → Offline maps → pick your area.') + '</div>';
    return '<div class="mr-offmaps" data-mroff="1">' +
      '<div class="meta">' + W('Télécharge la carte autour de toi avant de partir (montagne, sud…). Sans réseau, elle s’affiche avec ta position GPS. Le Wi-Fi est conseillé.',
        'حمّل الخريطة حولك قبل الانطلاق (الجبال، الجنوب…). بدون شبكة تظهر مع موقعك. يُنصح بشبكة Wi-Fi.',
        'Download the map around you before riding (mountains, south…). With no signal it shows with your GPS position. Wi-Fi recommended.') + '</div>' +
      '<div class="row" style="flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px">' +
      '<label class="meta">' + W('Rayon', 'نصف القطر', 'Radius') + ' <select data-mroffkm="1">' + [15, 30, 50, 80].map(function (k) { return '<option value="' + k + '"' + (k === 30 ? ' selected' : '') + '>' + k + ' km</option>'; }).join('') + '</select></label>' +
      '<label class="meta">' + W('Détail', 'التفاصيل', 'Detail') + ' <select data-mroffz="1"><option value="12">' + W('Grandes routes', 'الطرق الرئيسية', 'Main roads') + '</option><option value="14" selected>' + W('Routes, pistes et villages', 'طرق ومسالك وقرى', 'Roads, tracks & villages') + '</option></select></label>' +
      '<span class="meta" data-mroffest="1"></span></div>' +
      '<div class="row"><button class="p" data-mroffdl="1">⬇️ ' + W('Télécharger autour de moi', 'تحميل حول موقعي', 'Download around me') + '</button></div>' +
      '<div class="meta" data-mroffprog="1" aria-live="polite"></div><div data-mrofflist="1"></div>' +
      '<div class="meta" style="opacity:.75;margin-top:6px">' + W('Carte : Protomaps © OpenStreetMap. Les pistes du sud peuvent être incomplètes : garde aussi ta trace GPX.', 'الخريطة: Protomaps © OpenStreetMap. قد تكون مسالك الجنوب ناقصة: احتفظ أيضًا بمسارك GPX.', 'Map: Protomaps © OpenStreetMap. Southern tracks may be incomplete: keep your GPX track too.') + '</div></div>';
  }
  function bindManager(root) {
    var box = root && root.querySelector('[data-mroff]'); if (!box || box._b) return; box._b = 1;
    var q = function (s) { return box.querySelector(s); }, btnTxt = function () { return '⬇️ ' + W('Télécharger autour de moi', 'تحميل حول موقعي', 'Download around me'); };
    function est() { var p = plan(+q('[data-mroffkm]').value, +q('[data-mroffz]').value);
      q('[data-mroffest]').textContent = '≈ ' + p.mb + ' Mo' + (p.tiles > MAX_TILES ? ' · ' + W('trop grand', 'كبير جدًا', 'too big') : ''); }
    function list() {
      Promise.all([zones(), usage()]).then(function (r) {
        var all = r[0], u = r[1], l = q('[data-mrofflist]'); if (!l) return;
        l.innerHTML = (all.length ? all.sort(function (a, b) { return b.at - a.at; }).map(function (z) {
          return '<div class="row" style="justify-content:space-between;align-items:center;gap:6px;border-top:1px solid var(--line,#333);padding:6px 0">' +
            '<span class="meta">🗺️ <b>' + esc(z.name) + '</b> · ' + z.km + ' km · ' + mo(z.bytes) + (z.done ? ' ✅' : ' · ⚠️ ' + W('incomplète', 'غير مكتملة', 'incomplete')) + '<br>' + new Date(z.at).toLocaleDateString() + '</span>' +
            '<button class="g" data-mroffdel="' + esc(z.id) + '" aria-label="' + W('Supprimer', 'حذف', 'Delete') + '">🗑️</button></div>';
        }).join('') : '<div class="meta">' + W('Aucune zone téléchargée.', 'لا توجد مناطق محمّلة.', 'No area downloaded yet.') + '</div>') +
          (u && u.quota ? '<div class="meta" style="opacity:.7">' + W('Espace utilisé par l’appli', 'المساحة المستعملة', 'Space used by the app') + ' : ' + mo(u.usage || 0) + ' / ' + mo(u.quota) + '</div>' : '');
      });
    }
    function track(pr) {
      var b = q('[data-mroffdl]'), prog = q('[data-mroffprog]');
      b.textContent = '⏹ ' + W('Arrêter', 'إيقاف', 'Stop');
      if (job) job.onProgress = function (ok, n, by, er) {
        prog.textContent = '⬇️ ' + Math.floor(ok / n * 100) + ' % · ' + mo(by) + (er ? ' · ' + er + ' ' + W('échecs', 'فشل', 'failed') : ''); };
      pr.then(function (z) { prog.textContent = z.done ? '✅ ' + W('Zone prête hors ligne', 'المنطقة جاهزة دون اتصال', 'Area ready offline') + ' (' + mo(z.bytes) + ')'
          : '⚠️ ' + W('Téléchargement incomplet : relance-le avec du réseau, le reste sera repris.', 'تحميل غير مكتمل: أعده مع الشبكة وسيُستكمل الباقي.', 'Incomplete download: run it again with a connection, it resumes.'); list(); },
        function (e2) { prog.textContent = '⚠️ ' + (e2 && e2.message === 'toobig' ? W('Zone trop grande.', 'المنطقة كبيرة جدًا.', 'Area too big.') : W('Téléchargement impossible pour le moment.', 'تعذّر التحميل حاليًا.', 'Download not possible right now.')); })
        .then(function () { b.textContent = btnTxt(); });
    }
    box.addEventListener('change', est);
    box.addEventListener('click', function (e) {
      var d = e.target.closest('[data-mroffdel]');
      if (d) { if (confirm(W('Supprimer cette zone du téléphone ?', 'حذف هذه المنطقة من الهاتف؟', 'Delete this area from the phone?'))) remove(d.getAttribute('data-mroffdel')).then(list); return; }
      var b = e.target.closest('[data-mroffdl]'); if (!b) return;
      if (job) { if (confirm(W('Arrêter le téléchargement ? Ce qui est déjà téléchargé est gardé.', 'إيقاف التحميل؟ ما تم تحميله يبقى محفوظًا.', 'Stop the download? What is already downloaded is kept.'))) job.cancel(); return; }
      var prog = q('[data-mroffprog]');
      if (navigator.onLine === false) { prog.textContent = '📴 ' + W('Il faut du réseau (le Wi-Fi de préférence) pour télécharger.', 'تحتاج إلى شبكة (يفضل Wi-Fi) للتحميل.', 'You need a connection (Wi-Fi preferred) to download.'); return; }
      var km = +q('[data-mroffkm]').value, zmax = +q('[data-mroffz]').value;
      if (plan(km, zmax).tiles > MAX_TILES) { prog.textContent = '⚠️ ' + W('Zone trop grande : réduis le rayon ou le détail.', 'المنطقة كبيرة جدًا: قلّل نصف القطر أو التفاصيل.', 'Area too big: reduce radius or detail.'); return; }
      var go = function (lat, lng) {
        var name = prompt(W('Nom de cette zone (ex. Tikjda) :', 'اسم هذه المنطقة (مثلاً تيكجدة):', 'Name of this area (e.g. Tikjda):'), '');
        if (name === null) { prog.textContent = ''; return; }
        var pr = download({ lat: lat, lng: lng, km: km, zmax: zmax, name: name });
        if (job) job.promise = pr;
        track(pr);
      };
      if (last) { go(last[0], last[1]); return; }
      prog.textContent = W('Recherche de ta position…', 'جارٍ تحديد موقعك…', 'Finding your position…');
      navigator.geolocation.getCurrentPosition(function (p) { go(p.coords.latitude, p.coords.longitude); },
        function () { prog.textContent = '⚠️ ' + W('Position introuvable : active le GPS.', 'الموقع غير متاح: فعّل GPS.', 'Position not found: turn on GPS.'); }, { enableHighAccuracy: true, timeout: 20000 });
    });
    est(); list();
    if (job && job.promise) track(job.promise); // téléchargement en cours lancé avant le rafraîchissement de l'écran
  }

  window.MrMaps = { ready: function () { return !!PM_URL; }, mount: mount, move: move, unmount: unmount, zones: zones, download: download,
    remove: remove, plan: plan, managerHtml: managerHtml, bindManager: bindManager, clearSeen: clearSeen };
})();
