/* MotoRoute — mode hors ligne (05/11/2026)
   1) Cache de lecture automatique : chaque lecture réussie du serveur (Supabase /rest/v1, GET) est gardée
      sur le téléphone, rangée PAR COMPTE (identifiant du jeton). Sans réseau, l'appli reçoit la dernière
      réponse connue au lieu d'une erreur : sorties, groupes, membres, annonces, bonnes adresses, fiche…
   2) Photos publiques (Supabase Storage, /object/public/) gardées aussi (nombre limité).
   3) Bandeau discret « Hors ligne · données du … » en haut de l'écran, et retour automatique au réseau.
   4) Écriture sans réseau (créer, modifier, supprimer) : message clair au lieu d'un échec silencieux.
   Rien ne quitte le téléphone : le cache est local, effacé à la déconnexion du compte.
   API : window.MrOffline.{online(), lastSync(), clear(), stats(), onChange(fn)} */
(function () {
  'use strict';
  var SUPA = 'https://ixtqlxltwuktpdznbhnx.supabase.co';
  var REST = SUPA + '/rest/v1/', PUB = SUPA + '/storage/v1/object/public/';
  var DB = 'mr_hors_ligne', ST_REST = 'rest', ST_IMG = 'img';
  var MAX_REST = 600, MAX_IMG = 250, MAX_BODY = 1500000; // ~1,5 Mo par réponse au plus
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!nativeFetch) return;

  var lg = function () { try { return typeof lang !== 'undefined' ? lang : (localStorage.getItem('mr_lang') || 'fr'); } catch (e) { return 'fr'; } };
  var W = function (f, a, e) { var l = lg(); return l === 'ar' ? a : l === 'en' ? e : f; };

  /* ---------- IndexedDB minimaliste ---------- */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      try {
        var r = indexedDB.open(DB, 1);
        r.onupgradeneeded = function () {
          var d = r.result;
          if (!d.objectStoreNames.contains(ST_REST)) d.createObjectStore(ST_REST).createIndex('at', 'at');
          if (!d.objectStoreNames.contains(ST_IMG)) d.createObjectStore(ST_IMG).createIndex('at', 'at');
        };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      } catch (e) { rej(e); }
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var t = d.transaction(store, mode), s = t.objectStore(store), out;
        try { out = fn(s); } catch (e) { rej(e); return; }
        t.oncomplete = function () { res(out && typeof IDBRequest !== 'undefined' && out instanceof IDBRequest ? out.result : out); };
        t.onerror = t.onabort = function () { rej(t.error); };
      });
    });
  }
  var get = function (store, k) { return tx(store, 'readonly', function (s) { return s.get(k); }); };
  var put = function (store, k, v) { return tx(store, 'readwrite', function (s) { s.put(v, k); }); };
  function trim(store, max) {
    return tx(store, 'readwrite', function (s) {
      var c = s.count();
      c.onsuccess = function () {
        var extra = c.result - max; if (extra <= 0) return;
        s.index('at').openCursor().onsuccess = function (ev) {
          var cur = ev.target.result; if (!cur || extra-- <= 0) return; cur.delete(); cur.continue();
        };
      };
    }).catch(function () {});
  }

  /* ---------- Compte propriétaire du cache (jamais mélanger deux comptes) ---------- */
  function uidOf(headers) {
    try {
      var a = headers && (typeof headers.get === 'function' ? headers.get('Authorization') : (headers.Authorization || headers.authorization));
      var tok = String(a || '').replace(/^Bearer\s+/i, '').split('.');
      if (tok.length === 3) {
        var b = tok[1].replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
        var p = JSON.parse(decodeURIComponent(escape(atob(b))));
        if (p && p.sub) return String(p.sub);
      }
    } catch (e) {}
    // Jeton expiré ou clé publique seule : on se fie au compte enregistré sur le téléphone.
    try { var s = JSON.parse(localStorage.getItem('sb-ixtqlxltwuktpdznbhnx-auth-token') || 'null'); if (s && s.user && s.user.id) return String(s.user.id); } catch (e) {}
    return null; // pas de compte connu : pas de cache (jamais de cache « anonyme » sous les règles d'accès)
  }
  /* Tables gardées pour la lecture hors ligne. Exclues volontairement : sos_alerts, member_positions,
     ride_positions, talkie_*, push_tokens, guardians (temps réel ou sondages : une vieille réponse tromperait). */
  var TABLES = /^(groups|group_members|rides|ride_participants|profiles|annonces|places|place_likes|partners|partner_items|partner_requests|group_messages|group_tracks|trajets|emergency_cards|user_blocks)$/;
  var READ_RPC = /^(mr_guard_list|mr_my_guard_code|mr_is_admin|trajets_comparables)$/;
  function tableOf(url) { var m = /\/rest\/v1\/([a-z0-9_]+)/i.exec(url); return m ? m[1] : ''; }
  function rpcOf(url) { var m = /\/rest\/v1\/rpc\/([a-z0-9_]+)/i.exec(url); return m ? m[1] : ''; }
  function hget(h, n) { try { return h ? (typeof h.get === 'function' ? h.get(n) : (h[n] || h[n.toLowerCase()] || '')) : ''; } catch (e) { return ''; } }

  /* ---------- État réseau + bandeau ---------- */
  var state = { off: navigator.onLine === false, cached: false, last: 0 };
  try { state.last = +localStorage.getItem('mr_off_last') || 0; } catch (e) {}
  var subs = [];
  function emit() { subs.forEach(function (f) { try { f(api.online(), state); } catch (e) {} }); paint(); }
  function setOff(v) { if (state.off !== v) { state.off = v; if (!v) state.cached = false; emit(); } }
  function markSync() { state.last = Date.now(); try { localStorage.setItem('mr_off_last', String(state.last)); } catch (e) {} }

  function ago(t) {
    if (!t) return W('jamais', 'أبدًا', 'never');
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return W("à l'instant", 'الآن', 'just now');
    if (m < 60) return W('il y a ' + m + ' min', 'منذ ' + m + ' د', m + ' min ago');
    var h = Math.round(m / 60); if (h < 24) return W('il y a ' + h + ' h', 'منذ ' + h + ' س', h + ' h ago');
    var d = new Date(t); return d.toLocaleDateString(lg() === 'ar' ? 'ar-DZ' : lg() === 'en' ? 'en-GB' : 'fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toTimeString().slice(0, 5);
  }
  var bar = null, hideT = null;
  function paint() {
    if (!document.body) return;
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'mr_offbar'; bar.setAttribute('role', 'status'); bar.setAttribute('aria-live', 'polite');
      bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:calc(env(safe-area-inset-top,0px) + 4px);z-index:2147483000;' +
        'max-width:92vw;padding:5px 12px;border-radius:999px;font:600 12px/1.3 system-ui,sans-serif;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);' +
        'pointer-events:auto;cursor:pointer;display:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      bar.onclick = function () { alertInfo(); };
      document.body.appendChild(bar);
    }
    clearTimeout(hideT);
    if (state.off || state.cached) {
      bar.style.background = 'rgba(120,70,0,.92)';
      bar.textContent = '📴 ' + W('Hors ligne', 'بلا اتصال', 'Offline') + (state.last ? W(' · données ', ' · بيانات ', ' · data ') + ago(state.last) : '');
      bar.style.display = 'block';
    } else if (bar.style.display === 'block') {
      bar.style.background = 'rgba(20,110,50,.92)';
      bar.textContent = '📶 ' + W('Connexion revenue', 'عاد الاتصال', 'Back online');
      hideT = setTimeout(function () { bar.style.display = 'none'; }, 2500);
    }
  }
  function alertInfo() {
    var m = W('Pas de réseau. Tu vois les données de ta dernière connexion (' + ago(state.last) + ').\n\n' +
      '• Le SOS reste utilisable : le SMS part sans internet, l\'alerte au groupe partira dès le retour du réseau.\n' +
      '• Les cartes hors ligne téléchargées s\'affichent avec ta position GPS.\n' +
      '• Créer ou modifier (sortie, message, annonce…) demande le réseau.',
      'لا توجد شبكة. ترى بيانات آخر اتصال (' + ago(state.last) + ').\n\n• نداء الاستغاثة يبقى متاحًا: الرسالة القصيرة تُرسل بدون إنترنت، وتنبيه المجموعة يُرسل عند عودة الشبكة.\n• الخرائط المحمّلة تظهر مع موقعك.\n• الإنشاء أو التعديل يحتاج إلى الشبكة.',
      'No network. You are seeing data from your last connection (' + ago(state.last) + ').\n\n• SOS still works: the SMS goes without internet, the group alert is sent when the network returns.\n• Downloaded offline maps show with your GPS position.\n• Creating or editing needs the network.');
    try { window.alert(m); } catch (e) {}
  }

  window.addEventListener('online', function () { setOff(false); });
  window.addEventListener('offline', function () { setOff(true); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setOff(navigator.onLine === false); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint); else paint();

  /* ---------- Enveloppe de fetch ---------- */
  var netErr = function (e) { return e && (e.name === 'TypeError' || e.name === 'AbortError' && navigator.onLine === false); };
  var SLOW_MS = 7000; // réseau trop faible : au-delà, on affiche le cache (la vraie réponse le mettra à jour)

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var headers = (init && init.headers) || (input && input.headers);
    if (url.indexOf(REST) === 0) {
      var rpc = rpcOf(url);
      if (method === 'GET' && !rpc && TABLES.test(tableOf(url))) return cachedRead(url, input, init, headers, '');
      if (method === 'POST' && rpc && READ_RPC.test(rpc) && init && typeof init.body === 'string') return cachedRead(url, input, init, headers, init.body);
      if (!rpc && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        // Écriture : une fois réussie, les lectures gardées de cette table sont périmées.
        return nativeFetch(input, init).then(function (r) { setOff(false); if (r.ok) invalidate(tableOf(url)); return r; });
      }
    }
    if (url.indexOf(PUB) === 0 && method === 'GET') return imgGet(url, input, init);
    return nativeFetch(input, init).then(function (r) { if (url.indexOf(SUPA) === 0) setOff(false); return r; });
  };

  function cachedRead(url, input, init, headers, body) {
    var uid = uidOf(headers);
    if (!uid) return nativeFetch(input, init);
    var key = uid + '|' + (hget(headers, 'Accept') || '') + '|' + url + (body ? '|' + body : '');
    var fromCache = function (err) {
      return get(ST_REST, key).then(function (c) {
        if (!c) throw err;
        state.cached = true; setOff(true); emit();
        var h = new Headers(c.h || {}); h.set('x-mr-cache', String(c.at));
        return new Response(c.b, { status: 200, statusText: 'OK (hors ligne)', headers: h });
      }, function () { throw err; });
    };
    if (navigator.onLine === false) return fromCache(new TypeError('Failed to fetch (hors ligne)'));
    var net = nativeFetch(input, init).then(function (r) {
      setOff(false);
      if (r.ok && r.status === 200) {
        r.clone().text().then(function (b) {
          if (b.length > MAX_BODY) return;
          var h = {}; ['content-type', 'content-range'].forEach(function (n) { var v = r.headers.get(n); if (v) h[n] = v; });
          markSync();
          put(ST_REST, key, { b: b, h: h, at: Date.now(), u: uid, t: tableOf(url) }).then(function () { if (Math.random() < 0.05) trim(ST_REST, MAX_REST); }).catch(function () {});
        }).catch(function () {});
      }
      return r;
    }, function (e) { if (netErr(e)) return fromCache(e); throw e; });
    // Réseau très lent (montagne) : si rien après 7 s et qu'une réponse est gardée, on la montre tout de suite.
    var slow = new Promise(function (res) {
      setTimeout(function () { get(ST_REST, key).then(function (c) { if (c) res(fromCache(new Error('lent'))); }, function () {}); }, SLOW_MS);
    });
    return Promise.race([net, slow]);
  }
  function invalidate(table) {
    if (!table) return;
    tx(ST_REST, 'readwrite', function (s) {
      s.openCursor().onsuccess = function (ev) { var c = ev.target.result; if (!c) return; if (c.value && c.value.t === table) c.delete(); c.continue(); };
    }).catch(function () {});
  }

  function imgGet(url, input, init) {
    var fromCache = function (err) {
      return get(ST_IMG, url).then(function (c) {
        if (!c) throw err; return new Response(c.b, { status: 200, headers: { 'content-type': c.t || 'image/jpeg' } });
      }, function () { throw err; });
    };
    if (navigator.onLine === false) return fromCache(new TypeError('Failed to fetch (hors ligne)'));
    return nativeFetch(input, init).then(function (r) {
      if (r.ok && r.status === 200) {
        r.clone().blob().then(function (b) {
          if (b.size > 800000) return;
          put(ST_IMG, url, { b: b, t: b.type, at: Date.now() }).then(function () { if (Math.random() < 0.05) trim(ST_IMG, MAX_IMG); }).catch(function () {});
        }).catch(function () {});
      }
      return r;
    }, function (e) { if (netErr(e)) return fromCache(e); throw e; });
  }

  /* ---------- Effacer le cache d'un compte à la déconnexion ---------- */
  function clear(uid) {
    return tx(ST_REST, 'readwrite', function (s) {
      s.openCursor().onsuccess = function (ev) {
        var c = ev.target.result; if (!c) return;
        if (!uid || (c.value && c.value.u === uid)) c.delete(); c.continue();
      };
    }).catch(function () {});
  }
  var hooked = false, lastUid = null;
  function hookAuth() {
    if (hooked) return; var c = window.mrSb; if (!c || !c.auth || !c.auth.onAuthStateChange) return; hooked = true;
    c.auth.onAuthStateChange(function (ev, session) {
      if (session && session.user) lastUid = session.user.id;
      if (ev === 'SIGNED_OUT') { clear(lastUid || null); lastUid = null; }
    });
  }
  var hk = setInterval(function () { hookAuth(); if (hooked) clearInterval(hk); }, 1000);
  setTimeout(function () { clearInterval(hk); }, 60000);

  var api = window.MrOffline = {
    online: function () { return !state.off; },
    lastSync: function () { return state.last; },
    ago: function () { return ago(state.last); },
    clear: function () { return clear(null); },
    info: alertInfo,
    onChange: function (f) { if (typeof f === 'function') subs.push(f); },
    stats: function () {
      return Promise.all([ST_REST, ST_IMG].map(function (s) { return tx(s, 'readonly', function (o) { return o.count(); }).catch(function () { return 0; }); }))
        .then(function (n) { return { lectures: n[0], photos: n[1], derniere: state.last }; });
    }
  };
})();
