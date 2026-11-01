/* MotoRoute test-73 (01/11/2026, demandé par Elaid) : la carte Route « Position et motards proches » fonctionne.
   - « Partager ma position avec mon groupe » (S.share) : la dernière position est envoyée au serveur
     (table member_positions, supabase/proches.sql) au plus une fois par minute, ou plus tôt si l'on a roulé 300 m.
     Seuls les membres actifs d'un groupe en commun la voient, et seulement si elle date de moins de 30 min.
     Position approximative (~2 km) si « Position approximative » est cochée dans la confidentialité (par défaut).
     Décocher la case efface la position du serveur tout de suite.
   - « Prévenir quand un motard est proche » (S.near) : toutes les minutes, l'app lit les positions des membres
     de ses groupes et prévient (vibration + bip + bandeau) quand l'un d'eux est à moins de 3 km.
     Une seule alerte par motard toutes les 2 heures.
   Les deux marchent tant que l'app est ouverte (en Conduite l'écran reste allumé). Il faut un compte connecté. */
(function () {
  var NEAR_M = 3000, SEND_MS = 60000, MOVE_M = 300, POLL_MS = 60000, FRESH_MIN = 15, REALERT_MS = 2 * 3600e3;
  var LG = function () { try { return lang; } catch (e) { return 'fr'; } };
  var W = function (f, a, e) { var l = LG(); return l == 'ar' ? a : l == 'en' ? e : f; };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var sb = function () { return window.mrSb || null; };
  var user = function () { try { return (window.mrUser && window.mrUser()) || null; } catch (e) { return null; } };
  var rad = function (d) { return d * Math.PI / 180; };
  function dist(a, b) {
    var dLa = rad(b[0] - a[0]), dLo = rad(b[1] - a[1]);
    var h = Math.pow(Math.sin(dLa / 2), 2) + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.pow(Math.sin(dLo / 2), 2);
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  var fmtD = function (m) { return m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1).replace('.', LG() == 'en' ? '.' : ',') + ' km'; };
  var fuzzy = function () { try { return !(S.plus && S.plus.prv && S.plus.prv.fz === false); } catch (e) { return true; } };

  var st = { watch: null, pos: null, acc: null, sentAt: 0, sentPos: null, shared: false, polledAt: 0,
             near: [], alerted: {}, err: '', busy: false };

  function gpsOn() {
    if (st.watch != null || !navigator.geolocation) return;
    try {
      st.watch = navigator.geolocation.watchPosition(function (p) {
        st.pos = [p.coords.latitude, p.coords.longitude]; st.acc = p.coords.accuracy;
        if (st.err == 'gps') st.err = '';
        tick();
      }, function () { st.err = 'gps'; paint(); }, { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 });
    } catch (e) { st.err = 'gps'; }
  }
  function gpsOff() { if (st.watch != null) { try { navigator.geolocation.clearWatch(st.watch); } catch (e) {} } st.watch = null; }

  function srvErr(e) {
    var c = e && (e.code || ''), m = String(e && e.message || '');
    st.err = (c == '42P01' || c == 'PGRST205' || /member_positions/.test(m)) ? 'sql' : 'net';
  }

  async function sendPos() {
    var c = sb(), u = user(); if (!c || !u || !st.pos) return;
    var now = Date.now();
    var moved = st.sentPos ? dist(st.sentPos, st.pos) : 1e9;
    if (now - st.sentAt < SEND_MS && !(moved > MOVE_M && now - st.sentAt > 25000)) return;
    var la = st.pos[0], lo = st.pos[1];
    if (fuzzy()) { la = Math.round(la * 50) / 50; lo = Math.round(lo * 50) / 50; } // grille de 0,02° ≈ 2 km
    st.sentAt = now;
    var r = await c.from('member_positions').upsert({ user_id: u.id, lat: la, lng: lo }, { onConflict: 'user_id' });
    if (r.error) { srvErr(r.error); st.sentAt = now - SEND_MS + 15000; return; }
    st.sentPos = st.pos.slice(); st.shared = true; if (st.err == 'sql' || st.err == 'net') st.err = '';
  }
  async function unshare() {
    var c = sb(), u = user(); st.shared = false; st.sentAt = 0; st.sentPos = null;
    if (!c || !u) return;
    try { await c.from('member_positions').delete().eq('user_id', u.id); } catch (e) {}
  }

  function beep() {
    try {
      var A = window.AudioContext || window.webkitAudioContext; if (!A) return;
      var a = new A(), o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.value = 660; g.gain.value = .18; o.connect(g); g.connect(a.destination);
      o.start(); o.frequency.setValueAtTime(990, a.currentTime + .2); o.stop(a.currentTime + .5);
      setTimeout(function () { try { a.close(); } catch (e) {} }, 900);
    } catch (e) {}
  }
  function banner(txt) {
    var b = document.getElementById('mrNearToast');
    if (!b) {
      b = document.createElement('div'); b.id = 'mrNearToast'; b.setAttribute('role', 'alert');
      b.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 64px);z-index:9998;background:#0f6b5c;color:#fff;font-weight:700;padding:14px 16px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.45);font-size:17px';
      b.onclick = function () { b.remove(); };
      document.body.appendChild(b);
    }
    b.textContent = txt;
    clearTimeout(b._t); b._t = setTimeout(function () { try { b.remove(); } catch (e) {} }, 8000);
  }
  function alertNear(r, d) {
    var txt = '🏍 ' + (r.first_name || W('Un motard', 'دراج', 'A rider')) + ' ' + W('est à', 'على بعد', 'is') + ' ' + fmtD(d) + W(' de toi', ' منك', ' from you');
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch (e) {}
    beep(); banner(txt);
    try { if (S.notifOn && window.Notification && Notification.permission === 'granted' && document.hidden) new Notification('MotoRoute', { body: txt }); } catch (e) {}
  }

  async function pollNear() {
    var c = sb(), u = user(); if (!c || !u || !st.pos) return;  // pas encore de position : on réessaie dès qu'elle arrive
    var now = Date.now(); if (now - st.polledAt < POLL_MS) return; st.polledAt = now;
    var since = new Date(now - FRESH_MIN * 60000).toISOString();
    var r = await c.from('member_positions').select('user_id,first_name,lat,lng,updated_at').neq('user_id', u.id).gt('updated_at', since).limit(200);
    if (r.error) { srvErr(r.error); st.polledAt = now - POLL_MS + 15000; return; }
    if (st.err == 'sql' || st.err == 'net') st.err = '';
    var L = [];
    (r.data || []).forEach(function (x) {
      if (!st.pos) return;
      var d = dist(st.pos, [x.lat, x.lng]);
      if (d <= NEAR_M) {
        L.push({ n: x.first_name, d: d, at: x.updated_at });
        if (!st.alerted[x.user_id] || now - st.alerted[x.user_id] > REALERT_MS) { st.alerted[x.user_id] = now; alertNear(x, d); }
      }
    });
    L.sort(function (a, b) { return a.d - b.d; });
    st.near = L;
  }

  async function tick() {
    if (st.busy) return; st.busy = true;
    try {
      var share = !!S.share, near = !!S.near, u = user();
      if ((!share || !u) && st.shared) await unshare();
      if (!u || (!share && !near) || document.hidden) { gpsOff(); if (!share && !near) { st.near = []; st.err = ''; } return; }
      gpsOn();
      if (share) await sendPos();
      if (near) await pollNear(); else st.near = [];
    } catch (e) { st.err = 'net'; }
    finally { st.busy = false; paint(); }
  }

  function statusHtml() {
    var share = !!S.share, near = !!S.near, out = [];
    if (!share && !near) return '';
    if (!user()) out.push('⚠️ ' + W('Connecte-toi à ton compte pour utiliser ces options.', 'سجّل الدخول إلى حسابك لاستعمال هذه الخيارات.', 'Sign in to your account to use these options.'));
    else if (st.err == 'gps') out.push('⚠️ ' + W('Position GPS introuvable : active la localisation.', 'تعذّر تحديد الموقع: فعّل تحديد الموقع.', 'No GPS position: turn on location.'));
    else if (st.err == 'sql') out.push('⚠️ ' + W('Serveur pas encore prêt (script proches.sql à installer).', 'الخادم غير جاهز بعد (يجب تثبيت proches.sql).', 'Server not ready yet (proches.sql script to install).'));
    else if (st.err == 'net') out.push('⚠️ ' + W('Pas de connexion au serveur, nouvel essai bientôt.', 'لا اتصال بالخادم، محاولة جديدة قريباً.', 'No server connection, retrying soon.'));
    else if (!st.pos) out.push('📡 ' + W('Recherche de ta position…', 'جارٍ تحديد موقعك…', 'Finding your position…'));
    if (share && st.shared && st.sentAt) {
      var s = Math.max(0, Math.round((Date.now() - st.sentAt) / 1000));
      out.push('📡 ' + W('Position partagée avec tes groupes', 'موقعك مُشارك مع مجموعاتك', 'Position shared with your groups') +
        (fuzzy() ? W(' (approximative)', ' (تقريبي)', ' (approximate)') : '') + ' · ' + W('il y a ', 'منذ ', '') + (s < 60 ? s + ' s' : Math.round(s / 60) + ' min') + (LG() == 'en' ? ' ago' : ''));
    }
    if (near && st.pos && st.polledAt && !st.err) {
      out.push(st.near.length
        ? '🏍 ' + W('Motards proches : ', 'دراجون قريبون: ', 'Nearby riders: ') + st.near.map(function (x) { return '<b>' + esc(x.n || '?') + '</b> ' + fmtD(x.d); }).join(' · ')
        : '🏍 ' + W('Aucun membre de tes groupes à moins de 3 km.', 'لا يوجد عضو من مجموعاتك على أقل من 3 كم.', 'No member of your groups within 3 km.'));
    }
    return out.map(function (x) { return '<div class="meta" style="margin-top:6px">' + x + '</div>'; }).join('');
  }
  function paint() { var e = document.getElementById('mrProches'); if (e) e.innerHTML = statusHtml(); }

  // Place la zone d'état sous la carte « Position et motards proches » de l'onglet Route
  if (typeof routeView == 'function') {
    var _rv = routeView;
    routeView = function (t) {
      var h = _rv(t);
      try { var k = t.loc_note + '</div>'; var i = h.indexOf(k); if (i >= 0) h = h.slice(0, i + k.length) + '<div id="mrProches">' + statusHtml() + '</div>' + h.slice(i + k.length); } catch (e) {}
      return h;
    };
  }
  // Une case cochée ou décochée : on agit tout de suite
  document.addEventListener('change', function (e) {
    var o = e.target && e.target.dataset && e.target.dataset.opt;
    if (o == 'share' || o == 'near') { st.polledAt = 0; if (o == 'share') { if (e.target.checked) st.sentAt = 0; else unshare(); } setTimeout(tick, 50); }
  }, true);
  document.addEventListener('visibilitychange', function () { setTimeout(tick, 300); });
  setInterval(tick, 15000);
  setTimeout(tick, 2500);
  window.mrProches = { tick: tick, state: st };
})();
