/* MotoRoute – alertes sonores d'urgence et « anges gardiens » (test-40, 20/10/2026)
   - Chaque téléphone Android enregistre son jeton de notification (table push_tokens).
   - Un motard partage son code ; ses proches l'entrent dans « Veiller sur un motard » (table guardians).
   - En cas de chute, la fonction serveur « sos-push » envoie une notification sirène aux anges gardiens
     et aux membres de ses groupes ; à l'ouverture, l'app affiche l'alerte et la lit à voix haute.
   Gratuit : Firebase Cloud Messaging + Supabase. */
(function () {
  const L = () => (typeof lang !== 'undefined' ? lang : 'fr');
  const W = (f, a, e) => (L() === 'ar' ? a : L() === 'en' ? e : f);
  const ESC = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const native = () => { try { return !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()); } catch (e) { return false; } };
  const PN = () => (native() && window.MR_FCM && Capacitor.Plugins && Capacitor.Plugins.PushNotifications) || null;
  const MR = () => (native() && Capacitor.Plugins && Capacitor.Plugins.MrSms) || null;
  const sb = () => window.mrSb, me = () => window.mrUser && window.mrUser();

  /* ---------- Lecture vocale de l'alerte reçue ---------- */
  function sayText(d) {
    if (d.say) return d.say;
    const n = d.who || d.from || W('Un motard', 'دراج', 'A rider');
    const t = d.test === '1' ? W('Ceci est un test. ', 'هذه تجربة. ', 'This is a test. ') : '';
    return t + W(`Alerte MotoRoute. ${n} a fait une chute à moto et ne répond plus. Ouvre MotoRoute pour voir sa position.`,
      `تنبيه موتوروت. ${n} سقط بالدراجة النارية ولا يرد. افتح موتوروت لرؤية موقعه.`,
      `MotoRoute alert. ${n} has crashed on a motorcycle and is not answering. Open MotoRoute to see the location.`);
  }
  window.mrSpeakStop = function () { try { MR() && MR().stopSpeak(); } catch (e) {} try { MR() && MR().stopSiren && MR().stopSiren(); } catch (e) {} };

  /* test-47 : la sirène et la lecture vocale sont jouées par le service Android (même app fermée).
     Ici : afficher l'alerte ; si on vient de toucher l'alerte (tapped), couper la sirène et lire le message une fois. */
  function handle(d, tapped) {
    if (d && d.type === 'info') { try { window.mrPartnersReload && window.mrPartnersReload(); } catch (e) {} return; }
    if (!d || d.type !== 'sos') return;
    if (d.self === '1') { selfOk = Date.now(); const o = document.getElementById('mr_gself'); if (o) o.innerHTML = '✅ ' + W('<b>Reçu !</b> Ce téléphone reçoit bien les alertes de MotoRoute.', '<b>وصل!</b> هذا الهاتف يستقبل تنبيهات MotoRoute.', '<b>Received!</b> This phone gets MotoRoute alerts.'); if (!tapped) return; }
    const lat = d.lat !== '' && d.lat != null ? +d.lat : null, lng = d.lng !== '' && d.lng != null ? +d.lng : null;
    const a = { user_id: d.uid || ('push-' + (d.who || d.from || '')), first_name: d.who || d.from, kind: 'chute', msg: d.msg || '', lat, lng,
      created_at: new Date(+d.at || Date.now()).toISOString(), voice: true };
    try { window.mrSosReceive && window.mrSosReceive(a); } catch (e) {}
    if (tapped) {
      try { MR() && MR().stopSiren && MR().stopSiren(); } catch (e) {}
      try { MR() && MR().speak({ say: sayText(d), lang: L(), repeat: 1 }); } catch (e) {}
    }
  }
  /* alerte touchée dans la barre de notifications (app fermée ou en arrière-plan) */
  async function takeSos() {
    const P = MR(); if (!P || !P.takeSos) return;
    try { const r = await P.takeSos(); if (r && r.data) handle(JSON.parse(r.data), true); } catch (e) {}
  }
  setTimeout(takeSos, 1500); setInterval(takeSos, 2500);
  try { const A = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.App; if (A) A.addListener('resume', () => setTimeout(takeSos, 300)); } catch (e) {}

  /* ---------- Enregistrement du téléphone ---------- */
  let regUser = null, regAt = 0, listening = false, selfOk = 0;
  async function setup() {
    const P = PN(), c = sb(), u = me();
    if (!P || !c || !u || (regUser === u.id && Date.now() - regAt < 30 * 60 * 1000)) return;
    try {
      if (!listening) {
        listening = true;
        try {
          await P.createChannel({ id: 'sos_alarm', name: W('Alertes SOS (chute)', 'تنبيهات الطوارئ', 'SOS alerts (crash)'),
            description: W('Sirène quand un proche ou un membre de ton groupe chute', 'صفارة عند سقوط أحد المقربين', 'Siren when someone you watch over crashes'),
            importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#FF3B30', sound: 'sos_alarm' });
        } catch (e) {}
        P.addListener('registration', async t => {
          const uu = me(); if (!uu || !t || !t.value) return;
          try {
            const r = await sb().from('push_tokens').upsert({ user_id: uu.id, token: t.value, lang: ['fr', 'ar', 'en'].includes(L()) ? L() : 'fr', updated_at: new Date().toISOString() });
            if (r && r.error) { regAt = 0; report('jeton-fcm-enregistrement-serveur', r.error); }
          } catch (e) { regAt = 0; report('jeton-fcm-enregistrement-serveur', e); }
        });
        P.addListener('registrationError', e => { regAt = 0; report('jeton-fcm-refuse-par-firebase', null, { error: String((e && e.error) || e || '').slice(0, 120) }); });
        P.addListener('pushNotificationReceived', n => handle(n && n.data));
        P.addListener('pushNotificationActionPerformed', a => handle(a && a.notification && a.notification.data, true));
      }
      let p = await P.checkPermissions();
      if (p.receive === 'prompt' || p.receive === 'prompt-with-rationale') p = await P.requestPermissions();
      if (p.receive !== 'granted') return;
      regUser = u.id; regAt = Date.now();
      /* test-45 : si le serveur a effacé le jeton de ce téléphone (jugé mort), on en redemande un tout neuf à Firebase */
      let mine = null;
      try { const q = await c.from('push_tokens').select('token').eq('user_id', u.id).maybeSingle(); mine = q.data; } catch (e) {}
      if (!mine && P.unregister) { try { await P.unregister(); } catch (e) {} }
      await P.register();
    } catch (e) { report('jeton-fcm-setup', e instanceof Error ? e : null, { msg: String((e && e.message) || e).slice(0, 120) }); }
  }
  setTimeout(setup, 3500); setInterval(setup, 20000);

  /* ---------- Envoi depuis le téléphone qui a chuté ---------- */
  /* test-67 : chaque échec est signalé à Sentry (s'il est chargé), sans jamais bloquer le SOS */
  function report(what, err, extra) {
    try {
      if (window.mrSosReport) return window.mrSosReport(what, err, extra);
      const SN = window.Sentry; if (!SN) return;
      const ctx = { tags: { mr: 'push', mr_step: what }, extra: extra || {} };
      if (err instanceof Error) SN.captureException(err, ctx); else SN.captureMessage('Push : ' + what, ctx);
    } catch (e) {}
  }
  // Un seul appel à sos-push. Rend { done, res } pour la file d'attente de sos.js.
  // L'identité de l'expéditeur vient uniquement du jeton de connexion (le serveur ignore tout identifiant du corps).
  async function callPush(o) {
    const c = sb(), u = me();
    if (!c || !u) return { done: false, why: 'nouser' };
    const body = { lat: o.lat, lng: o.lng, test: o.test === true, self: o.self === true, aid: o.aid || undefined, msg: o.msg, say: o.say };
    const r = await c.functions.invoke('sos-push', { body });
    if (!r.error) {
      const d = r.data || { ok: false, why: 'erreur' };
      if (d.ok) {
        if (!d.sent && d.recipients) report('sirene-aucun-telephone-atteint', null, { recipients: d.recipients, errors: (d.errors || []).slice(0, 2) });
        return { done: true, res: d };
      }
      if (d.why === 'trop' || d.why === 'nofcm') { report('sirene-' + d.why, null); return { done: true, res: d }; }
      return { done: false, why: d.why || 'erreur', err: new Error('sos-push: ' + (d.why || 'erreur')) };
    }
    // Erreur HTTP : on lit la réponse du serveur (401 = session expirée → on réessaie après rafraîchissement)
    let d = null, st = 0;
    try { const ctx = r.error.context; st = ctx && ctx.status || 0; d = ctx && ctx.json ? await ctx.json() : null; } catch (e) {}
    if (d && (d.why === 'trop' || d.why === 'nofcm')) { report('sirene-' + d.why, null); return { done: true, res: d }; }
    if (st === 401) { try { await c.auth.refreshSession(); } catch (e) {} }
    return { done: false, why: st ? 'http' + st : 'net', err: r.error };
  }
  window.mrPushSos = async function (o) {
    o = o || {};
    const c = sb(), u = me();
    if (!c || !u) return { ok: false, why: 'nouser' };
    // Vraie alerte : passe par la file persistante de sos.js (renvoi automatique quand le réseau revient, sans doublon)
    if (!o.test && !o.self && window.MrSosQueue) {
      try {
        const x = await window.MrSosQueue.add('push', o);
        if (x.state === 'pending') return { ok: false, why: 'queued', id: x.id };
        return Object.assign({ id: x.id }, x.res || { ok: false, why: x.why || 'net' });
      } catch (e) { report('sirene-file', e); }
    }
    // Tests (sirène de test, réception sur ce téléphone) : 3 essais immédiats, pas de file (un test qui sonnerait 1 h plus tard serait trompeur)
    for (let k = 0; k < 3; k++) {
      try {
        const out = await callPush(o);
        if (out.done) return out.res;
        if (k === 2) { report('sirene-test-echec', out.err, { why: out.why }); return { ok: false, why: 'net' }; }
      } catch (e) { if (k === 2) { report('sirene-test-echec', e); return { ok: false, why: 'net' }; } }
      await new Promise(r => setTimeout(r, 3000));
    }
    return { ok: false, why: 'net' };
  };
  if (window.MrSosQueue) window.MrSosQueue.register('push', callPush);
  else report('file-sos-absente', null); // sos.js doit être chargé avant push.js
  // Quand la sirène en attente finit par partir, on l'affiche dans le cadre du SOS s'il est encore ouvert
  if (window.MrSosQueue) window.MrSosQueue.on((x, res) => {
    if (x.ch !== 'push' || x.state === 'pending' || x.tries < 2) return;
    const el = document.getElementById('sos_auto');
    if (el) el.insertAdjacentHTML('beforeend', '<div>' + (x.state === 'cancelled' ? W('Sirène annulée.', 'أُلغيت الصفارة.', 'Siren cancelled.') : window.mrPushStatus(res || { ok: false, why: x.why })) + '</div>');
  });
  window.mrPushStatus = function (r) {
    if (r && r.ok) {
      if (!r.recipients) return '<span style="color:#ff6b6b">' + W('🔕 <b>Personne n’a reçu la sirène</b> : aucun ange gardien relié et aucun membre dans tes groupes. Sur le téléphone de ton proche : Route → Détection de chute → « Veiller sur un motard » → entre ton code.', '🔕 <b>لم يتلقَّ أحد الصفارة</b>: لا يوجد ملاك حارس مرتبط ولا أعضاء في مجموعاتك. في هاتف قريبك: الطريق ← كشف السقوط ← «حراسة دراج» ← أدخل رمزك.', '🔕 <b>Nobody got the siren</b>: no guardian angel linked and nobody in your groups. On your close one’s phone: Route → Crash detection → “Watch over a rider” → enter your code.') + '</span>';
      if (!r.sent && r.errors && r.errors.length) return '<span style="color:#ff6b6b">' + W(`🔕 Google a refusé l'envoi de la sirène. Ferme puis rouvre MotoRoute sur les deux téléphones et réessaie.`, `🔕 رفضت غوغل إرسال الصفارة. أغلق MotoRoute وافتحه على الهاتفين ثم أعد المحاولة.`, `🔕 Google refused to send the siren. Close and reopen MotoRoute on both phones and try again.`) + `<br><small>${ESC(r.errors[0])}</small></span>`;
      if (!r.sent) return '<span style="color:#ff6b6b">' + W(`🔕 ${r.recipients} personne(s) à prévenir, mais leur téléphone n’est pas enregistré pour les alertes. Sur leur téléphone : ouvrir MotoRoute (connecté), accepter les notifications, attendre 10 secondes, puis réessaie.`, `🔕 ${r.recipients} شخص للتنبيه لكن لا أحد لديه التطبيق المحدث: لم ترن الصفارة.`, `🔕 ${r.recipients} to alert, but none has an up-to-date signed-in MotoRoute Android: the siren rang nowhere.`) + '</span>';
      return '🔔 ' + W(`Alerte sonore envoyée à ${r.sent} téléphone${r.sent > 1 ? 's' : ''}`, `أُرسل تنبيه صوتي إلى ${r.sent} هاتف`, `Siren alert sent to ${r.sent} phone${r.sent > 1 ? 's' : ''}`) +
        (r.recipients > r.sent ? W(` (${r.recipients - r.sent} sans l'app Android à jour)`, ` (${r.recipients - r.sent} بدون التطبيق)`, ` (${r.recipients - r.sent} without the Android app)`) : '');
    }
    const w = r && r.why;
    if (w === 'nofcm') return '⚠️ ' + W('Alertes sonores pas encore activées sur le serveur.', 'التنبيهات الصوتية غير مفعلة بعد.', 'Siren alerts not enabled on the server yet.');
    if (w === 'trop') return '⚠️ ' + W('Trop d’alertes en 1 heure (5 au maximum) : alerte sonore non renvoyée.', 'تنبيهات كثيرة خلال ساعة: لم يُرسل.', 'Too many alerts in 1 hour (5 max).');
    if (w === 'nouser') return '⚠️ ' + W('Pas connecté : pas d’alerte sonore.', 'غير متصل: لا تنبيه صوتي.', 'Not signed in: no siren alert.');
    if (w === 'queued') return '⏳ ' + W('Pas d’internet : sirène en attente, elle partira toute seule dès que le réseau revient (pendant 2 h).', 'لا إنترنت: الصفارة في الانتظار وستُرسل فور عودة الشبكة (خلال ساعتين).', 'No internet: siren waiting, it will go out as soon as the network is back (for 2 h).');
    if (w === 'expire') return '❌ ' + W('Pas d’internet pendant 2 h : sirène abandonnée.', 'لا إنترنت لمدة ساعتين: أُلغيت الصفارة.', 'No internet for 2 h: siren dropped.');
    return '❌ ' + W('Pas d’internet : alerte sonore non envoyée.', 'لا إنترنت: لم يُرسل التنبيه الصوتي.', 'No internet: siren alert not sent.');
  };

  /* ---------- Anges gardiens (carte « Détection de chute ») ---------- */
  window.mrGuardHtml = function () {
    setTimeout(fillGuard, 30);
    return `<div class="meta" id="mr_guard" style="margin:8px 0;padding:10px;border-radius:10px;border:1px solid var(--line,#444)">🛡️ <b>${W('Mes anges gardiens', 'ملائكتي الحارسة', 'My guardian angels')}</b><div class="meta">${W('Chargement…', 'جارٍ التحميل…', 'Loading…')}</div></div>`;
  };
  let code = null, gList = null, gAt = 0, gVal = '', gFocus = false;
  /* test-44 : l'écran se redessine souvent (GPS…) : la carte était refaite à chaque fois et le code tapé était effacé
     avant d'appuyer sur « Valider » (mr_guard_join n'était jamais appelé). On garde ce qui est tapé et on recharge la liste au plus toutes les 20 s. */
  document.addEventListener('input', e => { if (e.target && e.target.id === 'mr_gcode') gVal = e.target.value; });
  document.addEventListener('focusin', e => { if (e.target && e.target.id === 'mr_gcode') gFocus = true; });
  document.addEventListener('focusout', e => { if (e.target && e.target.id === 'mr_gcode') gFocus = false; });
  async function fillGuard(force) {
    const el = document.getElementById('mr_guard'); if (!el) return;
    const c = sb(), u = me();
    const head = `🛡️ <b>${W('Mes anges gardiens', 'ملائكتي الحارسة', 'My guardian angels')}</b>`;
    if (!c || !u) { el.innerHTML = head + `<div class="meta">${W('Connecte-toi pour que tes proches reçoivent une sirène si tu chutes.', 'سجّل الدخول ليصل تنبيه صوتي لمقربيك عند السقوط.', 'Sign in so your close ones get a siren if you crash.')}</div>`; return; }
    let list = gList || [];
    try {
      if (!code) { const r = await c.rpc('mr_my_guard_code'); if (!r.error) code = r.data; }
      if (force || !gList || Date.now() - gAt > 20000) { const l = await c.rpc('mr_guard_list'); if (!l.error) { list = gList = l.data || []; gAt = Date.now(); } }
    } catch (e) {}
    const elNow = document.getElementById('mr_guard'); if (!elNow) return;
    const gs = list.filter(x => x.kind === 'g'), rs = list.filter(x => x.kind === 'r');
    const chip = x => `<span style="display:inline-block;margin:3px 4px 0 0;padding:3px 8px;border-radius:999px;border:1px solid var(--line,#555)">${ESC(x.first_name)} <a href="#" data-gdel="${ESC(x.kind)}:${ESC(x.other_id)}" style="text-decoration:none">✕</a></span>`;
    elNow.innerHTML = head +
      `<div class="meta">${W('Ils reçoivent une <b>sirène + lecture vocale</b> sur leur téléphone si tu chutes (gratuit, il faut internet). Ils doivent avoir MotoRoute Android et un compte.', 'يصلهم <b>صفارة وقراءة صوتية</b> عند سقوطك (مجاني، يحتاج إنترنت). يجب أن يكون لديهم MotoRoute أندرويد وحساب.', 'They get a <b>siren + spoken alert</b> on their phone if you crash (free, needs internet). They need MotoRoute Android and an account.')}</div>` +
      (code ? `<div style="margin:6px 0;font-size:22px;font-weight:800;letter-spacing:3px">${ESC(code)}</div><div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap"><button class="p" data-gshare="1">📤 ${W('Envoyer mon code', 'إرسال رمزي', 'Send my code')}</button></div>` : `<div class="meta">${W('Code indisponible (serveur pas encore prêt).', 'الرمز غير متوفر.', 'Code unavailable.')}</div>`) +
      `<div class="meta" style="margin-top:6px">${W('Veillent sur moi', 'يحرسونني', 'Watching over me')} : ${gs.length ? gs.map(chip).join('') : '<b style="color:#ff6b6b">' + W('personne pour l’instant : en cas de chute, aucune sirène ne sonnera chez un proche.', 'لا أحد بعد: عند السقوط لن ترن الصفارة عند أي قريب.', 'nobody yet: after a crash, no siren will ring for anyone.') + '</b>'}</div>` +
      (gs.length ? `<div class="row" style="justify-content:flex-start"><button class="g" data-gtest="1">🔔 ${W('Tester la sirène chez eux', 'تجربة الصفارة عندهم', 'Test the siren on their phones')}</button></div><div class="meta" id="mr_gtst"></div>` : '') +
      `<div class="meta" style="margin-top:8px">👁️ <b>${W('Veiller sur un motard', 'حراسة دراج', 'Watch over a rider')}</b></div>` +
      `<div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap"><input id="mr_gcode" maxlength="6" placeholder="${W('Code à 6 lettres', 'رمز من 6 أحرف', '6-letter code')}" style="text-transform:uppercase;max-width:150px"><button class="g" data-gjoin="1">${W('Valider', 'تأكيد', 'Confirm')}</button></div>` +
      (rs.length ? `<div class="meta">${W('Je veille sur', 'أحرس', 'I watch over')} : ${rs.map(chip).join('')}</div>` : '') +
      (native() && window.MR_FCM ? `<div class="meta" id="mr_gstate"></div>` : '') +
      (native() && !window.MR_FCM ? `<div class="meta" style="color:#ff6b6b">${W('Cette version ne reçoit pas encore les alertes : installe la prochaine version.', 'هذه النسخة لا تستقبل التنبيهات بعد.', 'This version cannot receive alerts yet.')}</div>` : '') +
      (!native() ? `<div class="meta">${W('Sur iPhone / navigateur, les alertes arrivent seulement quand MotoRoute est ouvert.', 'على آيفون أو المتصفح تصل التنبيهات فقط والتطبيق مفتوح.', 'On iPhone / browser, alerts only arrive while MotoRoute is open.')}</div>` : '');
    fillState();
    const inp = document.getElementById('mr_gcode');
    if (inp && gVal) { inp.value = gVal; }
    if (inp && gFocus) { try { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) {} }
  }
  /* test-47 : ce téléphone peut-il recevoir la sirène ? (notifications, canal sirène, économie de batterie) */
  let stAt = 0, stHtml = '';
  async function fillState() {
    const el = document.getElementById('mr_gstate'), P = MR(); if (!el || !P || !P.alertState) return;
    if (Date.now() - stAt > 15000) {
      stAt = Date.now();
      try {
        const r = await P.alertState(), ok = r.notif && r.channel;
        stHtml = `📲 <b>${W('Ce téléphone', 'هذا الهاتف', 'This phone')}</b> : ` +
          (ok ? '✅ ' + W('peut recevoir la sirène', 'يمكنه استقبال الصفارة', 'can receive the siren') : '❌ ' + W('notifications MotoRoute bloquées : la sirène ne peut pas sonner ici', 'إشعارات MotoRoute محظورة: لن ترن الصفارة هنا', 'MotoRoute notifications blocked: the siren cannot ring here') + ` <button class="g" data-gset="1">${W('Autoriser', 'السماح', 'Allow')}</button>`) +
          (r.battery ? '' : `<br>🔋 ${W('Économie de batterie active : Android peut bloquer la sirène quand MotoRoute est fermée.', 'توفير البطارية مفعّل: قد يمنع أندرويد الصفارة والتطبيق مغلق.', 'Battery saver is on: Android may block the siren while MotoRoute is closed.')} <button class="g" data-gbatt="1">${W('Mettre « Sans restriction »', 'اجعلها «بدون قيود»', 'Set to “Unrestricted”')}</button>`);
      } catch (e) { stHtml = ''; }
    }
    const e2 = document.getElementById('mr_gstate'); if (e2 && !e2.dataset.busy) e2.innerHTML = stHtml + `<div class="row" style="justify-content:flex-start"><button class="g" data-gself="1">📡 ${W('Tester la réception sur ce téléphone', 'تجربة الاستقبال على هذا الهاتف', 'Test reception on this phone')}</button></div><div class="meta" id="mr_gself"></div>`;
  }
  document.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest && t.closest('[data-gself]')) {
      const box = document.getElementById('mr_gstate'); if (box) box.dataset.busy = '1';
      const out = () => document.getElementById('mr_gself');
      const t0 = Date.now(); selfOk = 0;
      if (out()) out().textContent = W('⏳ Envoi par Google vers ce téléphone… (30 s max)', '⏳ إرسال عبر غوغل إلى هذا الهاتف…', '⏳ Sending through Google to this phone…');
      const r = await window.mrPushSos({ test: true, self: true, msg: W('Test de réception', 'تجربة الاستقبال', 'Reception test'),
        say: W('Test MotoRoute réussi. Ce téléphone reçoit bien la sirène.', 'نجحت تجربة موتوروت. هذا الهاتف يستقبل الصفارة.', 'MotoRoute test passed. This phone receives the siren.') });
      if (!r || !r.ok || !r.sent) { if (out()) out().innerHTML = window.mrPushStatus(r || {}); if (box) delete box.dataset.busy; return; }
      const wait = setInterval(() => {
        if (selfOk >= t0) { clearInterval(wait); if (box) delete box.dataset.busy; return; }
        if (Date.now() - t0 > 30000) {
          clearInterval(wait); if (box) delete box.dataset.busy;
          if (out()) out().innerHTML = '<span style="color:#ff6b6b">❌ ' + W('<b>Google a accepté l’alerte mais ce téléphone ne l’a pas reçue.</b> Le blocage est dans les réglages du téléphone (batterie, démarrage automatique, données en arrière-plan ou services Google).', '<b>قبلت غوغل التنبيه لكن الهاتف لم يستلمه.</b> المشكل في إعدادات الهاتف.', '<b>Google accepted the alert but this phone did not get it.</b> Something in the phone settings blocks it.') + '</span>';
        }
      }, 1000);
      return;
    }
    if (t.closest && t.closest('[data-gbatt]')) { try { await MR().openBattery(); } catch (x) {} stAt = 0; return; }
    if (t.closest && t.closest('[data-gset]')) { try { await MR().openSettings(); } catch (x) {} stAt = 0; return; }
    if (t.closest && t.closest('[data-gtest]')) {
      if (!confirm(W('Le téléphone de tes anges gardiens va sonner avec une alerte marquée TEST. Continuer ?', 'سيرن هاتف ملائكتك الحارسة بتنبيه مكتوب عليه تجربة. متابعة؟', 'Your guardian angels’ phones will ring with an alert marked TEST. Continue?'))) return;
      const o = document.getElementById('mr_gtst'); if (o) o.textContent = '…';
      const nm = (typeof S !== 'undefined' && S.me && S.me.name) || '';
      const r = await window.mrPushSos({ test: true, msg: W('TEST – ce n’est pas un vrai accident.', 'تجربة – ليست حادثًا حقيقيًا.', 'TEST – not a real accident.'), lat: null, lng: null,
        say: W(`Ceci est un test MotoRoute. ${nm} vérifie que la sirène marche. Ce n'est pas un vrai accident.`, `هذه تجربة من موتوروت. ${nm} يتحقق من عمل الصفارة. ليست حادثًا حقيقيًا.`, `This is a MotoRoute test. ${nm} is checking that the siren works. This is not a real accident.`) });
      if (o) o.innerHTML = window.mrPushStatus(r);
      return;
    }
    if (t.closest && t.closest('[data-gshare]')) {
      const txt = W(`Veille sur moi à moto avec MotoRoute 🛡️ : si je chute, ton téléphone sonne avec ma position. Dans MotoRoute (onglet Route → Détection de chute → « Veiller sur un motard »), entre mon code : ${code}`,
        `احرسني في رحلاتي مع MotoRoute 🛡️: إذا سقطت يرن هاتفك مع موقعي. في MotoRoute (الطريق ← كشف السقوط ← «حراسة دراج») أدخل رمزي: ${code}`,
        `Watch over me on my rides with MotoRoute 🛡️: if I crash, your phone rings with my location. In MotoRoute (Route tab → Crash detection → "Watch over a rider"), enter my code: ${code}`);
      try { if (window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Share) { await Capacitor.Plugins.Share.share({ text: txt }); return; } } catch (x) {}
      try { if (navigator.share) { await navigator.share({ text: txt }); return; } } catch (x) {}
      location.href = 'https://wa.me/?text=' + encodeURIComponent(txt);
      return;
    }
    if (t.closest && t.closest('[data-gjoin]')) {
      const v = (((document.getElementById('mr_gcode') || {}).value || gVal || '')).replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(v)) { alert(W('Le code fait 6 lettres ou chiffres.', 'الرمز من 6 أحرف أو أرقام.', 'The code has 6 letters or digits.')); return; }
      try {
        const r = await sb().rpc('mr_guard_join', { p_code: v });
        if (r.error) throw r.error;
        alert(W(`✅ Tu veilles maintenant sur ${r.data}. Si ${r.data} chute, ton téléphone sonnera.`, `✅ أنت الآن تحرس ${r.data}.`, `✅ You now watch over ${r.data}.`));
        gVal = ''; setup(); fillGuard(true);
      } catch (x) {
        const m = String(x && x.message || x);
        alert(/code-inconnu/.test(m) ? W('Code inconnu.', 'رمز غير معروف.', 'Unknown code.') : /propre/.test(m) ? W('C’est ton propre code 🙂', 'هذا رمزك 🙂', 'That is your own code 🙂') : W('Impossible pour l’instant (internet ?).', 'غير ممكن الآن.', 'Not possible right now.'));
      }
      return;
    }
    const d = t.closest && t.closest('[data-gdel]');
    if (d) {
      e.preventDefault();
      const [k, id] = d.dataset.gdel.split(':'), u = me(); if (!u) return;
      try {
        const q = sb().from('guardians').delete();
        await (k === 'g' ? q.eq('rider_id', u.id).eq('guardian_id', id) : q.eq('guardian_id', u.id).eq('rider_id', id));
      } catch (x) {}
      fillGuard(true);
    }
  });
})();
