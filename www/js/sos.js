/* MotoRoute – alertes SOS envoyées pour de vrai aux groupes (20/10/2026)
   - Envoi : une ligne par groupe actif dans la table Supabase « sos_alerts » (script supabase/sos-alertes.sql).
   - Réception : temps réel Supabase + vérification au démarrage et toutes les 45 s, tant que l'app est ouverte.
   - Fenêtres d'information au style MotoRoute à la place des alertes grises du téléphone. */
(function () {
  const L = () => (typeof lang !== 'undefined' ? lang : 'fr');
  const W = (f, a, e) => (L() === 'ar' ? a : L() === 'en' ? e : f);
  const ESC = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SEEN = 'mr_sos_seen';

  /* ---------- Fenêtres d'information MotoRoute (remplace alert()) ---------- */
  const css = document.createElement('style');
  css.textContent = `
  #mr_note{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,8,12,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:mrnIn .18s ease-out}
  #mr_note .b{max-width:420px;width:100%;background:var(--card,#1a1d22);color:var(--ink,#f1f1f1);border:1px solid var(--line,#333);border-top:3px solid var(--acc,#f2b705);border-radius:16px;padding:18px 18px 14px;box-shadow:0 18px 50px rgba(0,0,0,.45);font:16px/1.45 Barlow,Cairo,system-ui,sans-serif}
  #mr_note .t{white-space:pre-wrap;word-break:break-word}
  #mr_note .a{display:flex;justify-content:flex-end;margin-top:14px}
  #mr_note button{background:var(--acc,#f2b705);color:var(--on-acc,#111);border:0;border-radius:10px;padding:10px 22px;font:600 16px Barlow,Cairo,sans-serif}
  @keyframes mrnIn{from{opacity:0}to{opacity:1}}
  #mr_sos{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(120,0,0,.82);animation:mrSosP 1s ease-in-out infinite alternate}
  @keyframes mrSosP{from{background:rgba(120,0,0,.82)}to{background:rgba(190,10,10,.9)}}
  #mr_sos .b{max-width:440px;width:100%;background:#140708;color:#fff;border:2px solid #ff3b30;border-radius:18px;padding:20px;box-shadow:0 0 60px rgba(255,59,48,.6);font:16px/1.45 Barlow,Cairo,system-ui,sans-serif}
  #mr_sos h2{margin:0 0 6px;font:700 26px 'Barlow Condensed',Cairo,sans-serif;color:#ff6b61}
  #mr_sos .m{white-space:pre-wrap;word-break:break-word;margin:8px 0;color:#ffd9d6}
  #mr_sos .k{font-size:14px;color:#ffb3ad}
  #mr_sos .r{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
  #mr_sos a,#mr_sos button{flex:1 1 140px;text-align:center;text-decoration:none;border-radius:12px;padding:13px 10px;font:600 16px Barlow,Cairo,sans-serif;border:0}
  #mr_sos a{background:#ff3b30;color:#fff}#mr_sos button{background:#2a1416;color:#fff;border:1px solid #6b2a2a}`;
  document.head.appendChild(css);

  const queue = [];
  function showNext() {
    if (document.getElementById('mr_note') || !queue.length) return;
    const msg = queue.shift(), d = document.createElement('div');
    d.id = 'mr_note'; d.setAttribute('role', 'alertdialog');
    d.innerHTML = `<div class="b"><div class="t">${ESC(msg)}</div><div class="a"><button type="button">OK</button></div></div>`;
    const close = () => { d.remove(); setTimeout(showNext, 60); };
    d.querySelector('button').onclick = close;
    d.addEventListener('click', e => { if (e.target === d) close(); });
    // la fenêtre doit passer au-dessus d'une <dialog> ouverte (couche supérieure du navigateur)
    const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
    host.appendChild(d);
    setTimeout(() => { try { d.querySelector('button').focus(); } catch (e) {} }, 30);
  }
  window.alert = function (m) { queue.push(m == null ? '' : String(m)); showNext(); };

  /* ---------- Envoi ---------- */
  window.mrSosGrpLabel = () => W('Alerter mes groupes', 'تنبيه مجموعاتي', 'Alert my groups');
  window.mrSosStatus = function (r) {
    if (r && r.ok) return '✅ <b>' + W(`Alerte envoyée à ${r.n} groupe${r.n > 1 ? 's' : ''}`, `تم إرسال التنبيه إلى ${r.n} مجموعة`, `Alert sent to ${r.n} group${r.n > 1 ? 's' : ''}`) + '</b>';
    const why = r && r.why;
    if (why === 'nouser') return '⚠️ ' + W('Pas connecté : alerte non envoyée aux groupes. Appelle ou envoie WhatsApp.', 'غير متصل: لم يُرسل التنبيه. اتصل أو أرسل عبر واتساب.', 'Not signed in: groups not alerted. Call or use WhatsApp.');
    if (why === 'nogroup') return '⚠️ ' + W('Tu n’es membre d’aucun groupe : personne à alerter. Appelle ou envoie WhatsApp.', 'لست عضوًا في أي مجموعة. اتصل أو أرسل عبر واتساب.', 'You are not in any group. Call or use WhatsApp.');
    if (why === 'noserver') return '⚠️ ' + W('Alertes pas encore activées sur le serveur (script sos-alertes.sql). Appelle ou envoie WhatsApp.', 'التنبيهات غير مفعلة على الخادم بعد. اتصل أو أرسل عبر واتساب.', 'Alerts not enabled on the server yet. Call or use WhatsApp.');
    // test-67 : alerte gardée dans le téléphone et renvoyée toute seule quand internet revient
    if (why === 'queued') return '⏳ <b>' + W('Pas de réseau : alerte aux groupes en attente.', 'لا توجد شبكة: تنبيه المجموعات في الانتظار.', 'No network: group alert waiting.') + '</b> ' + W('Elle partira toute seule dès que internet revient (pendant 2 h). Le SMS, lui, part sans internet. Appelle aussi.', 'سيُرسل تلقائيًا فور عودة الإنترنت (خلال ساعتين). الرسالة القصيرة تُرسل دون إنترنت. اتصل أيضًا.', 'It will go out by itself as soon as internet is back (for 2 h). The SMS goes without internet. Call too.');
    if (why === 'trop') return '⚠️ ' + W('Trop d’alertes en 1 heure (5 au maximum) : alerte aux groupes non renvoyée. Appelle ou envoie WhatsApp.', 'تنبيهات كثيرة خلال ساعة (5 كحد أقصى). اتصل أو أرسل عبر واتساب.', 'Too many alerts in 1 hour (5 max). Call or use WhatsApp.');
    if (why === 'refus') return '⚠️ ' + W('Le serveur a refusé l’alerte (tu n’es plus membre actif de ce groupe ?). Appelle ou envoie WhatsApp.', 'رفض الخادم التنبيه. اتصل أو أرسل عبر واتساب.', 'The server refused the alert. Call or use WhatsApp.');
    if (why === 'expire') return '❌ ' + W('Pas de réseau pendant 2 h : alerte aux groupes abandonnée.', 'لا شبكة لمدة ساعتين: أُلغي تنبيه المجموعات.', 'No network for 2 h: group alert dropped.');
    return '❌ ' + W('Pas de réseau : alerte non envoyée. Appelle ou envoie WhatsApp.', 'لا توجد شبكة: لم يُرسل التنبيه. اتصل أو أرسل عبر واتساب.', 'No network: alert not sent. Call or use WhatsApp.');
  };

  async function activeGroups(c, u) {
    const r = await c.from('group_members').select('group_id,status').eq('user_id', u.id);
    if (r.error) throw r.error;
    return [...new Set((r.data || []).filter(x => (x.status || 'active') === 'active').map(x => x.group_id))];
  }
  function firstName(u) {
    const m = (u && u.user_metadata) || {};
    return String(m.first_name || (typeof S !== 'undefined' && S.me && S.me.name) || 'Motard').split(' ')[0].slice(0, 40);
  }

  /* ---------- test-67 : signalement à Sentry (jamais bloquant, sans position ni texte du message) ---------- */
  function report(what, err, extra) {
    try {
      const SN = window.Sentry; if (!SN) return;
      const ctx = { tags: { mr: 'sos', mr_step: what }, extra: extra || {} };
      if (err instanceof Error) SN.captureException(err, ctx);
      else SN.captureMessage('SOS : ' + what + (err ? ' (' + String((err && (err.code || err.message)) || err).slice(0, 120) + ')' : ''), ctx);
    } catch (e) {}
  }
  window.mrSosReport = report;

  /* ---------- test-67 : file d'attente SOS persistante ----------
     Sans réseau, l'alerte aux groupes (canal « grp ») et la sirène (canal « push », fonction sos-push)
     ne sont plus abandonnées : elles sont gardées dans le téléphone (localStorage, survit à la fermeture)
     et renvoyées dès que le réseau revient (événement « online », retour dans l'app, et nouvel essai
     après 5 s, 15 s, 30 s puis toutes les 60 s, pendant 2 h au maximum).
     Chaque alerte a un identifiant unique (aid) envoyé au serveur : un renvoi ne crée jamais de doublon.
     Le SMS local n'est pas concerné : il part tout de suite, sans internet.
     API pour l'écran : window.MrSosQueue.pending(), .all(), .cancel(), .flush(), .on(fn). */
  const QK = 'mr_sos_queue', DELAYS = [5000, 15000, 30000, 60000], MAX_AGE = 2 * 3600e3;
  const senders = {}, subs = [];
  let qbusy = false, qtimer = null, qmem = null;
  const uuid = () => {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  };
  function qload() {
    try { const a = JSON.parse(localStorage.getItem(QK) || '[]'); if (Array.isArray(a)) return (qmem = a); } catch (e) {}
    return qmem || (qmem = []);
  }
  function qsave(a) {
    // on garde les alertes terminées 24 h (pour afficher leur état), au plus 30 lignes
    const now = Date.now();
    qmem = a.filter(x => x.state === 'pending' || now - (x.end || x.at) < 24 * 3600e3).slice(-30);
    try { localStorage.setItem(QK, JSON.stringify(qmem)); } catch (e) { report('file-sauvegarde', e); }
  }
  const pub = x => ({ id: x.id, ch: x.ch, kind: x.p && x.p.kind, test: !!(x.p && x.p.test), at: x.at, tries: x.tries, next: x.next, state: x.state, why: x.why || null });
  function emit(x) { const v = pub(x); subs.slice().forEach(f => { try { f(v, x.res); } catch (e) {} }); }
  function plan() {
    clearTimeout(qtimer); qtimer = null;
    const p = qload().filter(x => x.state === 'pending');
    if (!p.length) return;
    const wait = Math.max(0, Math.min(...p.map(x => x.next || 0)) - Date.now());
    qtimer = setTimeout(flush, Math.min(wait, 60000) + 50);
  }
  function finish(a, x, state, res, why) {
    x.state = state; x.res = res || null; x.why = why || null; x.end = Date.now();
    qsave(a); emit(x);
  }
  // Un seul essai pour une alerte. Le « sender » rend { done:true, res } (fini, réussi ou refus définitif)
  // ou { done:false, why } (à réessayer) ; une exception = à réessayer.
  async function attempt(x, force) {
    let a = qload(), cur = a.find(y => y.id === x.id);
    if (!cur || cur.state !== 'pending') return cur;
    if (Date.now() - cur.at > MAX_AGE) { finish(a, cur, 'expired', null, 'expire'); report('abandon-apres-2h', null, { ch: cur.ch, tries: cur.tries }); return cur; }
    if (!force && (cur.next || 0) > Date.now()) return cur;
    const fn = senders[cur.ch];
    if (!fn) return cur; // le module qui envoie ce canal n'est pas encore chargé
    let out;
    try { out = await fn(cur.p, cur); } catch (e) { out = { done: false, why: 'net', err: e }; }
    a = qload(); cur = a.find(y => y.id === x.id);
    if (!cur || cur.state !== 'pending') return cur; // annulée pendant l'envoi
    cur.tries = (cur.tries || 0) + 1;
    if (out && out.done) { finish(a, cur, out.res && out.res.ok ? 'sent' : 'failed', out.res, out.res && out.res.why); return cur; }
    cur.why = (out && out.why) || 'net';
    cur.next = Date.now() + DELAYS[Math.min(cur.tries - 1, DELAYS.length - 1)];
    if (cur.tries === 1) report('echec-' + cur.ch + '-mis-en-file', out && out.err, { ch: cur.ch, why: cur.why });
    qsave(a); emit(cur);
    return cur;
  }
  async function flush(force) {
    if (qbusy) return; qbusy = true;
    try {
      for (const x of qload().filter(y => y.state === 'pending')) { await attempt(x, force === true); }
    } catch (e) { report('file-flush', e); }
    finally { qbusy = false; plan(); }
  }
  window.MrSosQueue = {
    // ajoute une alerte et fait tout de suite un premier essai ; rend l'état après cet essai
    async add(ch, payload) {
      const x = { id: (payload && payload.aid) || uuid(), ch, p: payload || {}, at: Date.now(), tries: 0, next: 0, state: 'pending' };
      x.p.aid = x.id;
      const a = qload(); a.push(x); qsave(a); emit(x);
      while (qbusy) await new Promise(r => setTimeout(r, 30));
      qbusy = true;
      let cur;
      try { cur = await attempt(x, true); } finally { qbusy = false; plan(); }
      return cur || x;
    },
    register(ch, fn) { senders[ch] = fn; setTimeout(flush, 0); },
    pending: () => qload().filter(x => x.state === 'pending').map(pub),
    all: () => qload().map(pub),
    // fausse alerte : on vide la file (rien ne partira plus) ; rend le nombre d'alertes retirées
    cancel() {
      const a = qload(); let n = 0;
      a.forEach(x => { if (x.state === 'pending') { x.state = 'cancelled'; x.end = Date.now(); n++; emit(x); } });
      qsave(a); plan(); return n;
    },
    flush: () => flush(true),
    on(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
  };
  try { window.addEventListener('online', () => flush(true)); } catch (e) {}
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(true); });
  try { const A = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App; if (A && A.addListener) A.addListener('resume', () => flush(true)); } catch (e) {}
  setInterval(() => { if (qload().some(x => x.state === 'pending')) flush(); }, 60000);
  setTimeout(flush, 1500); // alertes restées en attente quand l'app a été fermée

  /* Envoi réel aux groupes (un essai). Identifiant d'alerte « client_id » : le serveur ignore un renvoi déjà reçu. */
  let noCid = false; // serveur sans la colonne client_id (test-67.sql pas encore passé)
  async function sendGroups(p, x) {
    const c = window.mrSb, u = window.mrUser && window.mrUser();
    if (!c || !u) return { done: false, why: 'nouser' }; // déconnecté : on attend (2 h max)
    const gs = await activeGroups(c, u);
    if (!gs.length) return { done: true, res: { ok: false, why: 'nogroup' } };
    // heure réelle de l'alerte (pas celle du renvoi) : les membres voient « il y a 40 min » et non « à l'instant »
    const at = new Date(x && x.at || Date.now()).toISOString();
    const mk = cid => gs.map(g => Object.assign({ group_id: g, first_name: firstName(u), msg: String(p.msg || '').slice(0, 500), lat: p.lat, lng: p.lng, kind: p.kind === 'sos' ? 'sos' : 'chute', created_at: at }, cid ? { client_id: p.aid } : {}));
    let r = await c.from('sos_alerts').insert(mk(!noCid));
    if (r.error && /client_id/i.test(r.error.message || '')) { noCid = true; r = await c.from('sos_alerts').insert(mk(false)); }
    if (!r.error) return { done: true, res: { ok: true, n: gs.length } };
    const m = String(r.error.message || ''), code = String(r.error.code || '');
    if (code === '23505') return { done: true, res: { ok: true, n: gs.length, dup: true } }; // déjà reçue par le serveur
    if (/mr-sos-trop/.test(m)) { report('groupes-limite-5-par-heure', r.error); return { done: true, res: { ok: false, why: 'trop' } }; }
    if (/relation|schema cache/i.test(m) && /sos_alerts/i.test(m)) { report('groupes-table-absente', r.error); return { done: true, res: { ok: false, why: 'noserver' } }; }
    if (code === '42501' || /row-level security/i.test(m)) { report('groupes-refus-serveur', r.error); return { done: true, res: { ok: false, why: 'refus' } }; }
    return { done: false, why: 'net', err: r.error };
  }
  window.MrSosQueue.register('grp', sendGroups);

  window.mrSosSend = async function (msg, ll, kind) {
    const c = window.mrSb, u = window.mrUser && window.mrUser();
    if (!c || !u) return { ok: false, why: 'nouser' };
    let lat = null, lng = null;
    if (ll) { const p = String(ll).split(','); lat = parseFloat(p[0]); lng = parseFloat(p[1]); if (isNaN(lat) || isNaN(lng)) lat = lng = null; }
    try {
      const x = await window.MrSosQueue.add('grp', { msg: String(msg || '').slice(0, 500), lat, lng, kind: kind === 'sos' ? 'sos' : 'chute' });
      if (x.state === 'pending') return { ok: false, why: 'queued', id: x.id };
      return Object.assign({ id: x.id }, x.res || { ok: false, why: x.why || 'net' });
    } catch (e) { report('groupes-envoi', e); return { ok: false, why: 'net' }; }
  };

  /* test-67 : fausse alerte. Vide la file (rien ne partira plus) et retire des groupes les alertes déjà
     envoyées depuis 2 h (ceux qui ne les ont pas encore vues ne les verront plus). Une sirène déjà
     partie ne peut pas être rappelée. Rend { cancelled, removed }. */
  window.mrSosCancel = async function () {
    let cancelled = 0, removed = 0;
    try { cancelled = window.MrSosQueue.cancel(); } catch (e) { report('annulation-file', e); }
    const c = window.mrSb, u = window.mrUser && window.mrUser();
    if (c && u) {
      try {
        const r = await c.from('sos_alerts').delete().eq('user_id', u.id).gte('created_at', new Date(Date.now() - 2 * 3600e3).toISOString());
        if (r && r.error) report('annulation-serveur', r.error); else removed = 1;
      } catch (e) { report('annulation-serveur', e); }
    }
    return { cancelled, removed };
  };

  // Quand une alerte en file finit par partir, on met à jour la ligne d'état si elle est encore à l'écran
  window.MrSosQueue.on((x, res) => {
    if (x.ch !== 'grp' || x.state === 'pending' || x.tries < 2) return;
    const el = document.getElementById('sos_st') || document.getElementById('sos_gst');
    if (el) el.innerHTML = x.state === 'cancelled' ? W('Alerte aux groupes annulée.', 'أُلغي تنبيه المجموعات.', 'Group alert cancelled.') : window.mrSosStatus(res || { ok: false, why: x.why });
  });

  // Bouton « Alerter mes groupes » sous le SOS manuel (onglet Route)
  document.addEventListener('click', async e => {
    const b = e.target.closest && e.target.closest('[data-sosgrp]');
    if (!b) return;
    const out = document.getElementById('sosOut'), st = document.getElementById('sos_gst');
    b.disabled = true;
    if (st) st.textContent = W('Envoi…', 'جارٍ الإرسال…', 'Sending…');
    const r = await window.mrSosSend(out && out.dataset.msg, out && out.dataset.ll, 'sos');
    if (st) st.innerHTML = window.mrSosStatus(r);
    b.disabled = false;
  });

  /* ---------- Réception ---------- */
  const seen = () => { try { return JSON.parse(localStorage.getItem(SEEN) || '[]'); } catch (e) { return []; } };
  const markSeen = k => { try { const a = seen().filter(x => x !== k); a.unshift(k); localStorage.setItem(SEEN, JSON.stringify(a.slice(0, 200))); } catch (e) {} };
  const keyOf = a => a.user_id + '@' + Math.floor(new Date(a.created_at).getTime() / 120000);
  const sosQ = [];
  let tone = null;

  function siren(on) {
    try {
      if (!on) { if (tone) { tone.stop(); tone = null; } navigator.vibrate && navigator.vibrate(0); return; }
      if (tone) return;
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ac = new AC(), o = ac.createOscillator(), g = ac.createGain();
      o.type = 'square'; g.gain.value = 0.18; o.connect(g); g.connect(ac.destination); o.start();
      let hi = false; const iv = setInterval(() => { hi = !hi; o.frequency.setValueAtTime(hi ? 960 : 640, ac.currentTime); }, 380);
      tone = { stop() { clearInterval(iv); try { o.stop(); ac.close(); } catch (e) {} } };
      navigator.vibrate && navigator.vibrate([600, 300, 600, 300, 600, 300, 600, 300, 600]);
    } catch (e) {}
  }
  function ago(ts) {
    const m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
    return m < 1 ? W('à l’instant', 'الآن', 'just now') : m < 60 ? W(`il y a ${m} min`, `منذ ${m} د`, `${m} min ago`) : W(`il y a ${Math.round(m / 60)} h`, `منذ ${Math.round(m / 60)} س`, `${Math.round(m / 60)} h ago`);
  }
  function showSos() {
    if (document.getElementById('mr_sos') || !sosQ.length) { if (!sosQ.length) siren(false); return; }
    const a = sosQ.shift(), d = document.createElement('div');
    const fall = a.kind !== 'sos', who = ESC(a.first_name || W('Un membre', 'عضو', 'A member'));
    const map = a.lat != null && a.lng != null ? `https://maps.google.com/?q=${a.lat},${a.lng}` : '';
    d.id = 'mr_sos'; d.dataset.k = keyOf(a); d.setAttribute('role', 'alertdialog');
    d.innerHTML = `<div class="b"><h2>🚨 ${fall ? W(`${who} a peut-être chuté`, `ربما سقط ${who}`, `${who} may have crashed`) : W(`${who} demande de l’aide`, `${who} يطلب المساعدة`, `${who} needs help`)}</h2>
      <div class="k">${ago(a.created_at)}</div><div class="m">${ESC(a.msg || '')}</div>
      <div class="r">${map ? `<a href="${map}" target="_blank" rel="noopener">📍 ${W('Voir sa position', 'عرض موقعه', 'See location')}</a>` : ''}
      <button type="button" data-ok="1">✔ ${W('J’ai vu', 'رأيت', 'Seen')}</button></div></div>`;
    const done = () => { markSeen(keyOf(a)); try { window.mrSpeakStop && window.mrSpeakStop(); } catch (e) {} d.remove(); setTimeout(showSos, 80); };
    d.querySelector('[data-ok]').onclick = done;
    const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
    host.appendChild(d); if (!a.voice) siren(true);
  }
  function receive(a) {
    const u = window.mrUser && window.mrUser();
    if (!a || !u || a.user_id === u.id) return;
    if (Date.now() - new Date(a.created_at).getTime() > 6 * 3600e3) return;
    const k = keyOf(a);
    if (seen().includes(k) || sosQ.some(x => keyOf(x) === k)) return;
    const cur = document.getElementById('mr_sos'); if (cur && cur.dataset.k === k) return;
    sosQ.push(a); showSos();
  }
  async function poll() {
    const c = window.mrSb, u = window.mrUser && window.mrUser();
    if (!c || !u || document.hidden) return;
    try {
      const since = new Date(Date.now() - 6 * 3600e3).toISOString();
      const r = await c.from('sos_alerts').select('*').gte('created_at', since).neq('user_id', u.id).order('created_at', { ascending: true }).limit(30);
      (r.data || []).forEach(receive);
    } catch (e) {}
  }
  let chan = null, chanUser = null;
  function listen() {
    const c = window.mrSb, u = window.mrUser && window.mrUser();
    if (!c || !u) { if (chan) { try { c && c.removeChannel(chan); } catch (e) {} chan = null; chanUser = null; } return; }
    if (chan && chanUser === u.id) return;
    try {
      if (chan) c.removeChannel(chan);
      chanUser = u.id;
      chan = c.channel('mr-sos-' + u.id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_alerts' }, p => receive(p.new)).subscribe();
    } catch (e) { chan = null; }
  }
  window.mrSosReceive = receive;
  function boot() { listen(); poll(); }
  setTimeout(boot, 2500);
  setInterval(boot, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) boot(); });
})();
