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
    const n = d.from || W('Un motard', 'دراج', 'A rider');
    const t = d.test === '1' ? W('Ceci est un test. ', 'هذه تجربة. ', 'This is a test. ') : '';
    return t + W(`Alerte MotoRoute. ${n} a fait une chute à moto et ne répond plus. Ouvre MotoRoute pour voir sa position.`,
      `تنبيه موتوروت. ${n} سقط بالدراجة النارية ولا يرد. افتح موتوروت لرؤية موقعه.`,
      `MotoRoute alert. ${n} has crashed on a motorcycle and is not answering. Open MotoRoute to see the location.`);
  }
  window.mrSpeakStop = function () { try { MR() && MR().stopSpeak(); } catch (e) {} };

  function handle(d) {
    if (!d || d.type !== 'sos') return;
    const lat = d.lat !== '' && d.lat != null ? +d.lat : null, lng = d.lng !== '' && d.lng != null ? +d.lng : null;
    const a = { user_id: d.uid || ('push-' + (d.from || '')), first_name: d.from, kind: 'chute', msg: d.msg || '', lat, lng,
      created_at: new Date(+d.at || Date.now()).toISOString(), voice: true };
    try { window.mrSosReceive && window.mrSosReceive(a); } catch (e) {}
    try { MR() && MR().speak({ say: sayText(d), lang: L(), repeat: 3 }); } catch (e) {}
  }

  /* ---------- Enregistrement du téléphone ---------- */
  let regUser = null, listening = false;
  async function setup() {
    const P = PN(), c = sb(), u = me();
    if (!P || !c || !u || regUser === u.id) return;
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
          try { await sb().from('push_tokens').upsert({ user_id: uu.id, token: t.value, lang: ['fr', 'ar', 'en'].includes(L()) ? L() : 'fr', updated_at: new Date().toISOString() }); } catch (e) {}
        });
        P.addListener('registrationError', e => { try { window.Sentry && Sentry.captureMessage('Notifications : enregistrement refusé'); } catch (x) {} });
        P.addListener('pushNotificationReceived', n => handle(n && n.data));
        P.addListener('pushNotificationActionPerformed', a => handle(a && a.notification && a.notification.data));
      }
      let p = await P.checkPermissions();
      if (p.receive === 'prompt' || p.receive === 'prompt-with-rationale') p = await P.requestPermissions();
      if (p.receive !== 'granted') return;
      regUser = u.id;
      await P.register();
    } catch (e) {}
  }
  setTimeout(setup, 3500); setInterval(setup, 20000);

  /* ---------- Envoi depuis le téléphone qui a chuté ---------- */
  window.mrPushSos = async function (o) {
    const c = sb(), u = me();
    if (!c || !u) return { ok: false, why: 'nouser' };
    for (let k = 0; k < 3; k++) {
      try {
        const r = await c.functions.invoke('sos-push', { body: o });
        if (r.error) throw r.error;
        return r.data || { ok: false, why: 'erreur' };
      } catch (e) { if (k === 2) return { ok: false, why: 'net' }; await new Promise(r => setTimeout(r, 3000)); }
    }
  };
  window.mrPushStatus = function (r) {
    if (r && r.ok) {
      if (!r.recipients) return '<span style="color:#ff6b6b">' + W('🔕 <b>Personne n’a reçu la sirène</b> : aucun ange gardien relié et aucun membre dans tes groupes. Sur le téléphone de ton proche : Route → Détection de chute → « Veiller sur un motard » → entre ton code.', '🔕 <b>لم يتلقَّ أحد الصفارة</b>: لا يوجد ملاك حارس مرتبط ولا أعضاء في مجموعاتك. في هاتف قريبك: الطريق ← كشف السقوط ← «حراسة دراج» ← أدخل رمزك.', '🔕 <b>Nobody got the siren</b>: no guardian angel linked and nobody in your groups. On your close one’s phone: Route → Crash detection → “Watch over a rider” → enter your code.') + '</span>';
      if (!r.sent) return '<span style="color:#ff6b6b">' + W(`🔕 ${r.recipients} personne(s) à prévenir, mais aucune n’a MotoRoute Android à jour et connecté : la sirène n’a sonné nulle part.`, `🔕 ${r.recipients} شخص للتنبيه لكن لا أحد لديه التطبيق المحدث: لم ترن الصفارة.`, `🔕 ${r.recipients} to alert, but none has an up-to-date signed-in MotoRoute Android: the siren rang nowhere.`) + '</span>';
      return '🔔 ' + W(`Alerte sonore envoyée à ${r.sent} téléphone${r.sent > 1 ? 's' : ''}`, `أُرسل تنبيه صوتي إلى ${r.sent} هاتف`, `Siren alert sent to ${r.sent} phone${r.sent > 1 ? 's' : ''}`) +
        (r.recipients > r.sent ? W(` (${r.recipients - r.sent} sans l'app Android à jour)`, ` (${r.recipients - r.sent} بدون التطبيق)`, ` (${r.recipients - r.sent} without the Android app)`) : '');
    }
    const w = r && r.why;
    if (w === 'nofcm') return '⚠️ ' + W('Alertes sonores pas encore activées sur le serveur.', 'التنبيهات الصوتية غير مفعلة بعد.', 'Siren alerts not enabled on the server yet.');
    if (w === 'trop') return '⚠️ ' + W('Trop d’alertes en 10 min : alerte sonore non renvoyée.', 'تنبيهات كثيرة: لم يُرسل.', 'Too many alerts in 10 min.');
    if (w === 'nouser') return '⚠️ ' + W('Pas connecté : pas d’alerte sonore.', 'غير متصل: لا تنبيه صوتي.', 'Not signed in: no siren alert.');
    return '❌ ' + W('Pas d’internet : alerte sonore non envoyée.', 'لا إنترنت: لم يُرسل التنبيه الصوتي.', 'No internet: siren alert not sent.');
  };

  /* ---------- Anges gardiens (carte « Détection de chute ») ---------- */
  window.mrGuardHtml = function () {
    setTimeout(fillGuard, 30);
    return `<div class="meta" id="mr_guard" style="margin:8px 0;padding:10px;border-radius:10px;border:1px solid var(--line,#444)">🛡️ <b>${W('Mes anges gardiens', 'ملائكتي الحارسة', 'My guardian angels')}</b><div class="meta">${W('Chargement…', 'جارٍ التحميل…', 'Loading…')}</div></div>`;
  };
  let code = null;
  async function fillGuard() {
    const el = document.getElementById('mr_guard'); if (!el) return;
    const c = sb(), u = me();
    const head = `🛡️ <b>${W('Mes anges gardiens', 'ملائكتي الحارسة', 'My guardian angels')}</b>`;
    if (!c || !u) { el.innerHTML = head + `<div class="meta">${W('Connecte-toi pour que tes proches reçoivent une sirène si tu chutes.', 'سجّل الدخول ليصل تنبيه صوتي لمقربيك عند السقوط.', 'Sign in so your close ones get a siren if you crash.')}</div>`; return; }
    let list = [];
    try {
      if (!code) { const r = await c.rpc('mr_my_guard_code'); if (!r.error) code = r.data; }
      const l = await c.rpc('mr_guard_list'); if (!l.error) list = l.data || [];
    } catch (e) {}
    const gs = list.filter(x => x.kind === 'g'), rs = list.filter(x => x.kind === 'r');
    const chip = x => `<span style="display:inline-block;margin:3px 4px 0 0;padding:3px 8px;border-radius:999px;border:1px solid var(--line,#555)">${ESC(x.first_name)} <a href="#" data-gdel="${ESC(x.kind)}:${ESC(x.other_id)}" style="text-decoration:none">✕</a></span>`;
    el.innerHTML = head +
      `<div class="meta">${W('Ils reçoivent une <b>sirène + lecture vocale</b> sur leur téléphone si tu chutes (gratuit, il faut internet). Ils doivent avoir MotoRoute Android et un compte.', 'يصلهم <b>صفارة وقراءة صوتية</b> عند سقوطك (مجاني، يحتاج إنترنت). يجب أن يكون لديهم MotoRoute أندرويد وحساب.', 'They get a <b>siren + spoken alert</b> on their phone if you crash (free, needs internet). They need MotoRoute Android and an account.')}</div>` +
      (code ? `<div style="margin:6px 0;font-size:22px;font-weight:800;letter-spacing:3px">${ESC(code)}</div><div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap"><button class="p" data-gshare="1">📤 ${W('Envoyer mon code', 'إرسال رمزي', 'Send my code')}</button></div>` : `<div class="meta">${W('Code indisponible (serveur pas encore prêt).', 'الرمز غير متوفر.', 'Code unavailable.')}</div>`) +
      `<div class="meta" style="margin-top:6px">${W('Veillent sur moi', 'يحرسونني', 'Watching over me')} : ${gs.length ? gs.map(chip).join('') : '<b style="color:#ff6b6b">' + W('personne pour l’instant : en cas de chute, aucune sirène ne sonnera chez un proche.', 'لا أحد بعد: عند السقوط لن ترن الصفارة عند أي قريب.', 'nobody yet: after a crash, no siren will ring for anyone.') + '</b>'}</div>` +
      (gs.length ? `<div class="row" style="justify-content:flex-start"><button class="g" data-gtest="1">🔔 ${W('Tester la sirène chez eux', 'تجربة الصفارة عندهم', 'Test the siren on their phones')}</button></div><div class="meta" id="mr_gtst"></div>` : '') +
      `<div class="meta" style="margin-top:8px">👁️ <b>${W('Veiller sur un motard', 'حراسة دراج', 'Watch over a rider')}</b></div>` +
      `<div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap"><input id="mr_gcode" maxlength="6" placeholder="${W('Code à 6 lettres', 'رمز من 6 أحرف', '6-letter code')}" style="text-transform:uppercase;max-width:150px"><button class="g" data-gjoin="1">${W('Valider', 'تأكيد', 'Confirm')}</button></div>` +
      (rs.length ? `<div class="meta">${W('Je veille sur', 'أحرس', 'I watch over')} : ${rs.map(chip).join('')}</div>` : '') +
      (native() && !window.MR_FCM ? `<div class="meta" style="color:#ff6b6b">${W('Cette version ne reçoit pas encore les alertes : installe la prochaine version.', 'هذه النسخة لا تستقبل التنبيهات بعد.', 'This version cannot receive alerts yet.')}</div>` : '') +
      (!native() ? `<div class="meta">${W('Sur iPhone / navigateur, les alertes arrivent seulement quand MotoRoute est ouvert.', 'على آيفون أو المتصفح تصل التنبيهات فقط والتطبيق مفتوح.', 'On iPhone / browser, alerts only arrive while MotoRoute is open.')}</div>` : '');
  }
  document.addEventListener('click', async e => {
    const t = e.target;
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
      const v = ((document.getElementById('mr_gcode') || {}).value || '').trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(v)) { alert(W('Le code fait 6 lettres ou chiffres.', 'الرمز من 6 أحرف أو أرقام.', 'The code has 6 letters or digits.')); return; }
      try {
        const r = await sb().rpc('mr_guard_join', { p_code: v });
        if (r.error) throw r.error;
        alert(W(`✅ Tu veilles maintenant sur ${r.data}. Si ${r.data} chute, ton téléphone sonnera.`, `✅ أنت الآن تحرس ${r.data}.`, `✅ You now watch over ${r.data}.`));
        setup(); fillGuard();
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
      fillGuard();
    }
  });
})();
