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
  window.mrSosSend = async function (msg, ll, kind) {
    const c = window.mrSb, u = window.mrUser && window.mrUser();
    if (!c || !u) return { ok: false, why: 'nouser' };
    let lat = null, lng = null;
    if (ll) { const p = String(ll).split(','); lat = parseFloat(p[0]); lng = parseFloat(p[1]); if (isNaN(lat) || isNaN(lng)) lat = lng = null; }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const gs = await activeGroups(c, u);
        if (!gs.length) return { ok: false, why: 'nogroup' };
        const rows = gs.map(g => ({ group_id: g, first_name: firstName(u), msg: String(msg || '').slice(0, 500), lat, lng, kind: kind === 'sos' ? 'sos' : 'chute' }));
        const r = await c.from('sos_alerts').insert(rows);
        if (r.error) {
          if (/sos_alerts|relation|schema cache/i.test(r.error.message || '')) return { ok: false, why: 'noserver' };
          throw r.error;
        }
        return { ok: true, n: gs.length };
      } catch (e) {
        if (attempt === 2) return { ok: false, why: 'net' };
        await new Promise(r => setTimeout(r, 4000));
      }
    }
    return { ok: false, why: 'net' };
  };

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
    const done = () => { markSeen(keyOf(a)); d.remove(); setTimeout(showSos, 80); };
    d.querySelector('[data-ok]').onclick = done;
    const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
    host.appendChild(d); siren(true);
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
  function boot() { listen(); poll(); }
  setTimeout(boot, 2500);
  setInterval(boot, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) boot(); });
})();
