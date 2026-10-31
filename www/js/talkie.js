/* MotoRoute – TALKIE-WALKIE de groupe (push-to-talk) – 29/10/2026
   Un canal par groupe et par sortie, réservé aux membres. Une seule personne parle à la fois (half-duplex).

   Deux modes, choisis automatiquement :
   - A « direct » : audio en temps réel par WebRTC via Cloudflare Realtime (SFU). Tous les appels Cloudflare passent
     par la fonction serveur Supabase « talkie » (la clé secrète n'est JAMAIS dans l'app).
   - B « messages vocaux instantanés » (mode par défaut, et repli si le direct ne se connecte pas / réseau faible) :
     on appuie, on parle (30 s max), on relâche -> enregistrement envoyé dans le bucket privé « talkie-audio »
     + une ligne dans « talkie_messages » ; les autres membres connectés le reçoivent et le lisent tout seuls.
   Le tour de parole (qui parle) et la présence passent par Supabase Realtime (canal privé « talkie:g:<id> » / « talkie:r:<id> »).

   Points d'accroche :
   - Natif Android (autre module) : window.MrTalkie.pttDown() / pttUp() / toggle(), et l'événement
       window.dispatchEvent(new CustomEvent('mr-talkie-native', {detail:{type:'button'}}))   (bouton du casque Bluetooth)
     Ici on demande le service micro : window.Capacitor.Plugins.MrTalkie.start({channel}) / .stop() s'il existe.
   - Musique : le lecteur intégré expose window.mrMusicAudio (élément <audio>) : son volume baisse pendant une prise de parole.
     Autre branchement possible : window.MrTalkie.on('speaking', function (e) { ... }) avec e = {speaking, who, self, mode}.
   - Ce fichier ne dépend que de : window.mrSb (client Supabase), window.mrUser(), et des variables de l'app
     (lang, tab, gid, S, render, showSortie) qu'il lit sans jamais les modifier. */
(function () {
  if (window.MrTalkie) return;

  /* ------------------------------------------------------------------ Outils ------------------------------------------------------------------ */
  const LG = () => { try { return (typeof lang !== 'undefined' && lang) || 'fr'; } catch (e) { return 'fr'; } };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sb = () => window.mrSb || null;
  const me = () => (window.mrUser && window.mrUser()) || null;
  const BUCKET = 'talkie-audio', MAX_MS = 30000, MIN_MS = 400, TAP_MS = 350;
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const warn = (...a) => { try { console.warn('[talkie]', ...a); } catch (e) {} };

  /* ------------------------------------------------------------------ Textes FR / AR / EN ------------------------------------------------------------------ */
  const TX = {
    fr: { title: 'Talkie-walkie', chan: 'Canal', grp: 'Groupe', ride: 'Sortie', today: 'en cours',
      st_off: 'Pas dans un canal', st_conn: 'Connexion…', st_direct: 'Direct', st_msg: 'Messages vocaux', st_offline: 'Hors ligne',
      ptt_join: 'Rejoindre le canal', ptt_idle: 'Appuyer pour parler', ptt_talk: 'Je parle… relâche pour envoyer', ptt_latch: 'Je parle… touche pour arrêter',
      ptt_busy: '{n} parle', ptt_play: 'Écoute en cours', ptt_wait: 'Connexion…',
      who_none: 'Personne ne parle', who_speaks: '{n} parle…', who_me: 'Tu parles…', who_play: '{n} (message vocal)',
      vol: 'Volume', auto: 'Lecture automatique', leave: 'Quitter le canal', last: 'Réécouter le dernier message',
      pend: 'Écouter : {n}', pend_t: '{s} s',
      hint: 'Maintiens le bouton pour parler, ou touche-le brièvement pour démarrer, puis touche à nouveau pour arrêter. 30 s maximum. Un seul membre parle à la fois.',
      note_b: 'Messages vocaux : ton message part quand tu relâches et se lit tout seul chez les autres.', note_direct: 'Direct : les autres t’entendent tout de suite.',
      weak: 'Réseau faible : messages vocaux.', offline: 'Pas de réseau : ton message partira dès le retour du réseau.',
      err_mic: 'Micro refusé : autorise le micro pour MotoRoute dans les réglages du téléphone.', err_send: 'Message pas encore parti (réseau). Nouvel essai automatique.',
      err_rate: 'Trop de messages d’un coup : patiente quelques minutes.', err_fmt: 'Ce message audio n’est pas lisible sur cet appareil.', err_play: 'Lecture impossible.',
      busy: '{n} parle : attends la fin.', short: 'Trop court, rien n’a été envoyé.', sent: 'Message envoyé.', max: 'Limite de 30 s atteinte : message envoyé.',
      unlock: '🔈 Touche ici pour activer le son', login: 'Connecte-toi (🔑) pour utiliser le talkie-walkie.', none: 'Rejoins un groupe ou une sortie pour utiliser le talkie-walkie.',
      ride_only: 'Participe à cette sortie pour utiliser son canal.', local_grp: 'Ce groupe n’est pas en ligne : le talkie-walkie ne marche que pour les groupes du serveur.',
      native_note: 'Bouton du casque Bluetooth : appui = parler / arrêter.' },
    ar: { title: 'جهاز الاتصال اللاسلكي', chan: 'القناة', grp: 'مجموعة', ride: 'رحلة', today: 'جارية',
      st_off: 'غير متصل بقناة', st_conn: 'جارٍ الاتصال…', st_direct: 'مباشر', st_msg: 'رسائل صوتية', st_offline: 'بدون إنترنت',
      ptt_join: 'الانضمام إلى القناة', ptt_idle: 'اضغط للتحدث', ptt_talk: 'أتحدث… أفلت للإرسال', ptt_latch: 'أتحدث… المس للإيقاف',
      ptt_busy: '{n} يتحدث', ptt_play: 'جارٍ الاستماع', ptt_wait: 'جارٍ الاتصال…',
      who_none: 'لا أحد يتحدث', who_speaks: '{n} يتحدث…', who_me: 'أنت تتحدث…', who_play: '{n} (رسالة صوتية)',
      vol: 'مستوى الصوت', auto: 'تشغيل تلقائي', leave: 'مغادرة القناة', last: 'إعادة سماع آخر رسالة',
      pend: 'استمع: {n}', pend_t: '{s} ث',
      hint: 'اضغط مطولًا على الزر للتحدث، أو المسه لحظة للبدء ثم المسه مرة أخرى للإيقاف. 30 ثانية كحد أقصى. عضو واحد فقط يتحدث في كل مرة.',
      note_b: 'رسائل صوتية: تُرسل رسالتك عند الإفلات وتُشغَّل تلقائيًا عند الآخرين.', note_direct: 'مباشر: يسمعك الآخرون فورًا.',
      weak: 'الشبكة ضعيفة: رسائل صوتية.', offline: 'لا توجد شبكة: ستُرسل رسالتك عند عودة الشبكة.',
      err_mic: 'تم رفض الميكروفون: اسمح بالميكروفون لـ MotoRoute من إعدادات الهاتف.', err_send: 'لم تُرسل الرسالة بعد (الشبكة). إعادة محاولة تلقائية.',
      err_rate: 'رسائل كثيرة دفعة واحدة: انتظر بضع دقائق.', err_fmt: 'هذه الرسالة الصوتية غير قابلة للتشغيل على هذا الجهاز.', err_play: 'تعذّر التشغيل.',
      busy: '{n} يتحدث: انتظر حتى ينتهي.', short: 'قصيرة جدًا، لم يُرسل شيء.', sent: 'تم إرسال الرسالة.', max: 'بلغت حد 30 ثانية: تم إرسال الرسالة.',
      unlock: '🔈 المس هنا لتفعيل الصوت', login: 'سجّل الدخول (🔑) لاستعمال جهاز الاتصال اللاسلكي.', none: 'انضم إلى مجموعة أو رحلة لاستعمال جهاز الاتصال اللاسلكي.',
      ride_only: 'شارك في هذه الرحلة لاستعمال قناتها.', local_grp: 'هذه المجموعة غير متصلة بالخادم: الجهاز يعمل فقط مع مجموعات الخادم.',
      native_note: 'زر سماعة البلوتوث: ضغطة = تحدّث / إيقاف.' },
    en: { title: 'Walkie-talkie', chan: 'Channel', grp: 'Group', ride: 'Ride', today: 'today',
      st_off: 'Not in a channel', st_conn: 'Connecting…', st_direct: 'Live', st_msg: 'Voice messages', st_offline: 'Offline',
      ptt_join: 'Join the channel', ptt_idle: 'Press to talk', ptt_talk: 'Talking… release to send', ptt_latch: 'Talking… tap to stop',
      ptt_busy: '{n} is talking', ptt_play: 'Listening', ptt_wait: 'Connecting…',
      who_none: 'Nobody is talking', who_speaks: '{n} is talking…', who_me: 'You are talking…', who_play: '{n} (voice message)',
      vol: 'Volume', auto: 'Auto-play', leave: 'Leave channel', last: 'Replay last message',
      pend: 'Listen: {n}', pend_t: '{s} s',
      hint: 'Hold the button to talk, or tap it briefly to start and tap again to stop. 30 s maximum. Only one member talks at a time.',
      note_b: 'Voice messages: your message is sent when you release and plays by itself for the others.', note_direct: 'Live: the others hear you right away.',
      weak: 'Weak network: voice messages.', offline: 'No network: your message will be sent when the network is back.',
      err_mic: 'Microphone denied: allow the microphone for MotoRoute in the phone settings.', err_send: 'Message not sent yet (network). Retrying automatically.',
      err_rate: 'Too many messages at once: wait a few minutes.', err_fmt: 'This audio message cannot be played on this device.', err_play: 'Playback failed.',
      busy: '{n} is talking: wait until they finish.', short: 'Too short, nothing was sent.', sent: 'Message sent.', max: '30 s limit reached: message sent.',
      unlock: '🔈 Tap here to enable sound', login: 'Log in (🔑) to use the walkie-talkie.', none: 'Join a group or a ride to use the walkie-talkie.',
      ride_only: 'Join this ride to use its channel.', local_grp: 'This group is not online: the walkie-talkie only works for server groups.',
      native_note: 'Bluetooth headset button: press = talk / stop.' },
  };
  const t = (k, v) => {
    let s = (TX[LG()] || TX.fr)[k]; if (s == null) s = TX.fr[k]; if (s == null) return k;
    if (v) for (const x in v) s = s.split('{' + x + '}').join(v[x]);
    return s;
  };

  /* ------------------------------------------------------------------ État ------------------------------------------------------------------ */
  const ST = {
    key: null,            // canal rejoint : « g:<uuid> » ou « r:<uuid> »
    sel: lsGet('mr_tk_ch', ''), // canal affiché dans la liste
    status: 'off',        // off | connecting | direct | messages | offline
    talking: false, starting: false, how: 'hold', live: false,
    speaker: null,        // { uid, name, self, mode:'live'|'rec'|'play' }
    vol: Math.min(1, Math.max(0, parseFloat(lsGet('mr_tk_vol', '1')) || 1)),
    auto: lsGet('mr_tk_auto', '1') !== '0',
    note: '', noteAt: 0, unlockNeeded: false, volOk: true, myName: '',
  };
  const listeners = {};
  const emit = (ev, d) => { (listeners[ev] || []).slice().forEach(f => { try { f(d); } catch (e) { warn('écouteur', e); } }); };
  let pressing = false, deferredRender = false, pressId = 0;

  /* ------------------------------------------------------------------ Audio : bips, lecture, volume, musique ------------------------------------------------------------------ */
  let actx = null, aud = null, unlocked = false;
  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  function audioEl() {
    if (aud) return aud;
    aud = document.createElement('audio'); aud.setAttribute('playsinline', ''); aud.preload = 'auto'; aud.style.display = 'none';
    document.body.appendChild(aud);
    try { aud.volume = 0.5; ST.volOk = Math.abs(aud.volume - 0.5) < 0.01; } catch (e) { ST.volOk = false; }
    aud.volume = ST.volOk ? ST.vol : 1;
    return aud;
  }
  /* À appeler dans un geste de l'utilisateur : iOS / Android n'autorisent le son automatique qu'après. */
  function unlock() {
    try {
      if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
      if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
    } catch (e) {}
    if (!unlocked) {
      try { const a = audioEl(); a.src = SILENT_WAV; const p = a.play(); if (p && p.then) p.then(() => { unlocked = true; ST.unlockNeeded = false; refresh(); }).catch(() => {}); else unlocked = true; } catch (e) {}
    }
  }
  /* Bips discrets (style radio réaliste) : start / end (moi), in / out (les autres), busy */
  const BEEPS = { start: [[1000, 0.08]], end: [[820, 0.07], [620, 0.09]], in: [[640, 0.06]], out: [[520, 0.08]], busy: [[230, 0.12], [230, 0.12]] };
  function beep(kind) {
    try {
      if (!actx) return; if (actx.state === 'suspended') actx.resume().catch(() => {});
      let at = actx.currentTime + 0.01;
      (BEEPS[kind] || []).forEach(([f, d]) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = kind === 'busy' ? 'square' : 'sine'; o.frequency.value = f;
        const peak = Math.max(0.02, 0.25 * ST.vol);
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, at + d);
        o.connect(g); g.connect(actx.destination); o.start(at); o.stop(at + d + 0.02); at += d + 0.05;
      });
    } catch (e) {}
  }
  function applyVolume() {
    try { if (aud && ST.volOk) aud.volume = ST.vol; } catch (e) {}
    Object.keys(D.peers).forEach(k => { const p = D.peers[k]; try { if (p.el && ST.volOk) p.el.volume = ST.vol; } catch (e) {} });
  }
  /* La musique de l'app (window.mrMusicAudio) baisse pendant qu'on parle ou qu'on écoute. */
  const duckS = { n: 0, prev: null };
  function duck(on) {
    try {
      const m = window.mrMusicAudio; if (!m) return;
      if (on) { duckS.n++; if (duckS.prev == null && !m.paused) { duckS.prev = m.volume; m.volume = Math.max(0.03, m.volume * 0.2); } }
      else { duckS.n = Math.max(0, duckS.n - 1); if (duckS.n === 0 && duckS.prev != null) { m.volume = duckS.prev; duckS.prev = null; } }
    } catch (e) {}
  }
  let duckHeld = false;
  let natSig = '';
  function natState() { const sp = ST.speaker, sig = (ST.talking ? 1 : 0) + ',' + (sp && !sp.self ? 1 : 0); if (sig === natSig || !ST.key) return; natSig = sig; natCall('state', { talking: !!ST.talking, receiving: !!(sp && !sp.self) }); }
  function setSpeaker(sp) {
    const was = !!ST.speaker; ST.speaker = sp;
    if (!!sp !== was) {
      if (sp && !duckHeld) { duckHeld = true; duck(true); } else if (!sp && duckHeld) { duckHeld = false; duck(false); }
      emit('speaking', { speaking: !!sp, who: sp ? sp.name : '', self: !!(sp && sp.self), mode: sp ? sp.mode : '' });
    } else if (sp) emit('speaking', { speaking: true, who: sp.name, self: !!sp.self, mode: sp.mode });
    natState(); refresh();
  }
  function note(msg, ms) { ST.note = msg || ''; ST.noteAt = Date.now(); refresh(); if (msg) { const at = ST.noteAt; setTimeout(() => { if (ST.noteAt === at) { ST.note = ''; refresh(); } }, ms || 6000); } }

  /* ------------------------------------------------------------------ Canaux disponibles ------------------------------------------------------------------ */
  const gS = () => { try { return typeof S !== 'undefined' ? S : null; } catch (e) { return null; } };
  const isToday = d => { try { const x = new Date(), s = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); return d === s; } catch (e) { return false; } };
  function channels() {
    const s = gS(), out = []; if (!s || !me()) return out;
    (s.groups || []).forEach(g => { if (g.srv && uuidRe.test(g.uid || '') && (g.me || g.owner)) out.push({ key: 'g:' + String(g.uid).toLowerCase(), label: g.name, kind: 'g' }); });
    (s.sorties || []).forEach(r => { if (r.srv && uuidRe.test(r.uid || '') && (r.joined || r.creator) && isToday(r.d)) out.push({ key: 'r:' + String(r.uid).toLowerCase(), label: r.t, kind: 'r', now: true }); });
    return out;
  }
  const chanLabel = key => { const c = channels().find(x => x.key === key); return c ? c.label : ''; };

  /* ------------------------------------------------------------------ Micro ------------------------------------------------------------------ */
  let micStream = null, micIdle = null;
  async function getMic() {
    clearTimeout(micIdle);
    if (micStream && micStream.getAudioTracks().some(x => x.readyState === 'live')) return micStream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nomic');
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e; micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    return micStream;
  }
  /* Le micro reste ouvert 8 s après avoir parlé (pas de coupure en début de phrase suivante), puis il est fermé. */
  function micIdleLater() { clearTimeout(micIdle); micIdle = setTimeout(() => { if (ST.talking || ST.starting) return; try { micStream && micStream.getTracks().forEach(x => x.stop()); } catch (e) {} micStream = null; }, 8000); }

  /* ------------------------------------------------------------------ Enregistrement (mode B) ------------------------------------------------------------------ */
  /* Format : AAC (audio/mp4) en premier = lu partout (Safari iOS, Android) ; sinon Opus/WebM. */
  function pickMime() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    const c = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (const x of c) { try { if (MediaRecorder.isTypeSupported(x)) return x; } catch (e) {} }
    return '';
  }
  const baseMime = m => String(m || '').split(';')[0].toLowerCase();
  let rec = null;
  function startRec(stream) {
    if (typeof MediaRecorder === 'undefined') return null;
    const mime = pickMime(), r = { chunks: [], t0: Date.now(), dur: 0, discard: false, mime: baseMime(mime) || 'audio/webm', mr: null };
    try {
      let mr; try { mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: /mp4/.test(mime) ? 32000 : 24000 } : { audioBitsPerSecond: 24000 }); } catch (e) { mr = new MediaRecorder(stream); }
      if (mr.mimeType) r.mime = baseMime(mr.mimeType) || r.mime;
      mr.ondataavailable = e => { if (e.data && e.data.size) r.chunks.push(e.data); };
      mr.onstop = () => {
        if (r.discard || r.dur < MIN_MS || !r.chunks.length) { if (!r.discard && r.dur < MIN_MS) note(t('short'), 3000); return; }
        outboxAdd({ key: r.key, blob: new Blob(r.chunks, { type: r.mime }), mime: r.mime, dur: r.dur, tries: 0 });
      };
      r.key = ST.key; mr.start(250); r.mr = mr;
    } catch (e) { warn('MediaRecorder', e); return null; }
    return r;
  }
  function stopRec(r, discard) {
    if (!r || !r.mr) return;
    r.discard = !!discard; r.dur = Date.now() - r.t0;
    try { if (r.mr.state !== 'inactive') r.mr.stop(); } catch (e) {}
  }

  /* ------------------------------------------------------------------ Envoi des messages (mode B) avec file d'attente ------------------------------------------------------------------ */
  const outbox = []; let sending = false;
  function outboxAdd(it) { if (!it.key) return; outbox.push(it); while (outbox.length > 3) outbox.shift(); flush(); }
  async function sendOne(it) {
    const c = sb(), u = me(); if (!c || !u) throw new Error('nouser');
    const kind = it.key[0], id = it.key.slice(2);
    const ext = /mp4/.test(it.mime) ? 'm4a' : /ogg/.test(it.mime) ? 'ogg' : 'webm';
    const path = id + '/' + u.id + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) + '.' + ext;
    const up = await c.storage.from(BUCKET).upload(path, it.blob, { contentType: it.mime, upsert: false, cacheControl: '3600' });
    if (up.error) throw up.error;
    const row = { path, mime: it.mime, duration_ms: Math.round(it.dur) }; row[kind === 'g' ? 'group_id' : 'ride_id'] = id;
    const ins = await c.from('talkie_messages').insert(row);
    if (ins.error) { try { await c.storage.from(BUCKET).remove([path]); } catch (e) {} throw ins.error; }
  }
  async function flush() {
    if (sending) return; sending = true;
    try {
      while (outbox.length) {
        if (navigator.onLine === false) { note(t('offline'), 5000); break; }
        const it = outbox[0];
        try { await sendOne(it); outbox.shift(); }
        catch (e) {
          const m = String((e && (e.message || e.error_description)) || e);
          if (/mr-talkie-trop/.test(m)) { outbox.shift(); note(t('err_rate'), 8000); continue; }
          if (/mr-talkie|row-level security|not allowed|nouser|mime|exceeded|too large|payload/i.test(m)) { outbox.shift(); warn('message refusé', m); continue; }
          it.tries++; if (it.tries >= 4) { outbox.shift(); warn('message abandonné', m); continue; }
          note(t('err_send'), 5000); await new Promise(r => setTimeout(r, 1000 * it.tries * 2));
        }
      }
    } finally { sending = false; }
  }
  window.addEventListener('online', () => { if (outbox.length) flush(); if (ST.key) { ensureChannels(); } });

  /* ------------------------------------------------------------------ Réception et lecture des messages (mode B) ------------------------------------------------------------------ */
  const seen = new Set(), queue = [], pending = []; let playing = false, lastMsg = null, lastSeenAt = 0, curPlayEl = null;
  function onMessage(row, late) {
    if (!row || !row.id || seen.has(row.id)) return; seen.add(row.id); if (seen.size > 300) seen.delete(seen.values().next().value);
    const u = me(); if (u && row.user_id === u.id) return;
    const at = Date.parse(row.created_at) || Date.now(); lastSeenAt = Math.max(lastSeenAt, at);
    const m = { id: row.id, who: row.first_name || t('title'), path: row.path, mime: row.mime, dur: row.duration_ms || 0, at };
    lastMsg = m;
    const fresh = Date.now() - at < 60000;
    if (ST.auto && fresh && !late) { queue.push(m); while (queue.length > 5) pending.push(queue.shift()); pump(); }
    else { pending.push(m); }
    while (pending.length > 8) pending.shift();
    emit('message', { who: m.who, id: m.id }); refresh();
  }
  async function pump() {
    if (playing || !queue.length || ST.talking || ST.starting) return;
    playing = true;
    const m = queue.shift();
    try { await playMsg(m); } catch (e) { warn('lecture', e); } finally { playing = false; setTimeout(pump, 60); }
  }
  async function playMsg(m) {
    const c = sb(); if (!c) return;
    const a = audioEl();
    if (m.mime && a.canPlayType && a.canPlayType(m.mime) === '') { note(t('err_fmt'), 6000); return; }
    const dl = await c.storage.from(BUCKET).download(m.path);
    if (dl.error || !dl.data) { note(t('err_play'), 4000); return; }
    const url = URL.createObjectURL(new Blob([dl.data], { type: m.mime || dl.data.type || 'audio/webm' }));
    try {
      a.src = url; a.volume = ST.volOk ? ST.vol : 1; curPlayEl = a;
      await new Promise((resolve) => {
        let done = false; const end = () => { if (done) return; done = true; a.onended = a.onerror = null; clearTimeout(to); resolve(); };
        const to = setTimeout(end, Math.max(4000, m.dur + 4000));
        a.onended = end; a.onerror = () => { note(t('err_play'), 4000); end(); };
        a.play().then(() => { setSpeaker({ uid: m.id, name: m.who, self: false, mode: 'play' }); beep('in'); }).catch(e => {
          if (e && e.name === 'NotAllowedError') { ST.unlockNeeded = true; pending.push(m); refresh(); }
          else { note(t('err_play'), 4000); }
          end();
        });
      });
    } finally {
      try { a.pause(); } catch (e) {} URL.revokeObjectURL(url); curPlayEl = null;
      if (ST.speaker && ST.speaker.mode === 'play') { beep('out'); setSpeaker(floor ? { uid: floor.uid, name: floor.name, self: false, mode: floor.mode } : null); }
    }
  }
  /* Messages manqués pendant une coupure réseau : on les propose (sans les lire tout seuls s'ils ont plus d'une minute) */
  async function catchUp() {
    const c = sb(), key = ST.key; if (!c || !key) return;
    try {
      const col = key[0] === 'g' ? 'group_id' : 'ride_id';
      const since = new Date(lastSeenAt ? lastSeenAt + 1 : Date.now() - 5 * 60000).toISOString();
      const r = await c.from('talkie_messages').select('id,user_id,first_name,path,mime,duration_ms,created_at').eq(col, key.slice(2)).gt('created_at', since).order('created_at', { ascending: true }).limit(8);
      if (key === ST.key && r && r.data) r.data.forEach(row => onMessage(row, false));
    } catch (e) {}
  }
  async function playPending(id) {
    unlock();
    const i = pending.findIndex(x => x.id === id); if (i < 0) return;
    const m = pending.splice(i, 1)[0]; queue.push(m); refresh(); pump();
  }
  function replayLast() { unlock(); if (lastMsg) { queue.push(lastMsg); pump(); } }

  /* ------------------------------------------------------------------ Tour de parole (broadcast) et présence ------------------------------------------------------------------ */
  let chRt = null, chDb = null, rtOk = false, dbOk = false, floor = null, floorTimer = null, myClaimAt = 0, dbRetry = null;
  const myId = () => { const u = me(); return u ? u.id : ''; };
  const myNameNow = () => ST.myName || (me() && me().user_metadata && (me().user_metadata.first_name || me().user_metadata.name)) || t('title');
  function sendFloor(p) { try { if (chRt && rtOk) chRt.send({ type: 'broadcast', event: 'floor', payload: Object.assign({ uid: myId(), name: myNameNow() }, p) }); } catch (e) {} }
  const floorBusy = () => !!(floor && floor.uid !== myId() && floor.until > Date.now()) || !!(ST.speaker && ST.speaker.mode === 'play');
  function onFloor(p) {
    if (!p || !p.uid || p.uid === myId()) return;
    if (p.t === 'claim') {
      /* Deux personnes appuient presque en même temps : le plus petit identifiant garde la parole */
      if ((ST.talking || ST.starting) && Date.now() - myClaimAt < 900 && p.uid < myId()) { stopTalk('lost', true); note(t('busy', { n: p.name || '' }), 3000); beep('busy'); }
      floor = { uid: p.uid, name: p.name || '?', mode: p.mode === 'live' ? 'live' : 'rec', until: Date.now() + MAX_MS + 2000 };
      clearTimeout(floorTimer); floorTimer = setTimeout(() => { floor = null; if (ST.speaker && !ST.speaker.self && ST.speaker.mode !== 'play') setSpeaker(null); }, MAX_MS + 2200);
      if (!ST.talking && !(ST.speaker && ST.speaker.mode === 'play')) { setSpeaker({ uid: p.uid, name: floor.name, self: false, mode: floor.mode }); if (p.mode === 'live') beep('in'); }
    } else if (p.t === 'release') {
      if (floor && floor.uid === p.uid) { floor = null; clearTimeout(floorTimer); }
      if (ST.speaker && ST.speaker.uid === p.uid && ST.speaker.mode !== 'play') { if (p.mode === 'live') beep('out'); setSpeaker(null); }
    }
  }
  function claim() { myClaimAt = Date.now(); sendFloor({ t: 'claim', mode: ST.live ? 'live' : 'rec' }); }
  function releaseFloor() { sendFloor({ t: 'release', mode: ST.live ? 'live' : 'rec' }); }
  const presence = () => { try { return chRt ? chRt.presenceState() : {}; } catch (e) { return {}; } };
  function presList() { const o = presence(), out = []; Object.keys(o).forEach(k => (o[k] || []).forEach(p => out.push(p))); return out; }
  const nonDirectPeers = () => presList().filter(p => p.uid && p.uid !== myId() && !p.direct).length;
  function track() { try { if (chRt && rtOk) chRt.track({ uid: myId(), name: myNameNow(), direct: !!D.ready, sid: D.sid || '', tn: D.tn }); } catch (e) {} }

  function setStatus(s) { if (ST.status !== s) { ST.status = s; emit('mode', { mode: s }); emit('state', API.state()); } refresh(); }
  function calcStatus() {
    if (!ST.key) return setStatus('off');
    if (navigator.onLine === false || (!dbOk && !rtOk && ST.connectedOnce)) return setStatus('offline');
    if (D.ready) return setStatus('direct');
    if (!dbOk && !ST.connectedOnce) return setStatus('connecting');
    setStatus('messages');
  }
  function ensureChannels() {
    const c = sb(), key = ST.key; if (!c || !key) return;
    if (chDb && chDb.state === 'joined' && chRt && chRt.state === 'joined') return;
    teardownChannels();
    const col = key[0] === 'g' ? 'group_id' : 'ride_id', id = key.slice(2);
    // 1) messages (postgres_changes, protégés par les règles RLS de la table) – indépendant du canal privé
    try {
      chDb = c.channel('talkie-db:' + key + ':' + myId().slice(0, 8))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'talkie_messages', filter: col + '=eq.' + id }, p => onMessage(p && p.new, false))
        .subscribe(s => {
          dbOk = s === 'SUBSCRIBED'; if (dbOk) { ST.connectedOnce = true; catchUp(); }
          if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') { clearTimeout(dbRetry); dbRetry = setTimeout(() => { if (ST.key === key && !dbOk) { chDb = null; ensureChannels(); } }, 8000); }
          calcStatus();
        });
    } catch (e) { warn('db', e); }
    // 2) qui parle + présence (broadcast / presence, canal PRIVÉ : seuls les membres y entrent)
    try {
      chRt = c.channel('talkie:' + key, { config: { private: true, broadcast: { self: false, ack: false }, presence: { key: myId() } } })
        .on('broadcast', { event: 'floor' }, m => onFloor(m && m.payload))
        .on('presence', { event: 'sync' }, () => { onPresence(); refresh(); })
        .subscribe(s => { rtOk = s === 'SUBSCRIBED'; if (rtOk) { track(); startDirect(); } calcStatus(); });
    } catch (e) { warn('rt', e); }
  }
  function teardownChannels() {
    const c = sb();
    try { chDb && c && c.removeChannel(chDb); } catch (e) {}
    try { chRt && c && c.removeChannel(chRt); } catch (e) {}
    chDb = chRt = null; dbOk = rtOk = false; floor = null; clearTimeout(floorTimer); clearTimeout(dbRetry);
  }

  /* ------------------------------------------------------------------ Mode A : direct (Cloudflare Realtime SFU, via la fonction « talkie ») ------------------------------------------------------------------ */
  const D = { ready: false, pc: null, sid: '', tn: 'mic', trans: null, peers: {}, q: Promise.resolve(), retry: null, tries: 0, gen: 0, box: null };
  const weakNet = () => { try { const n = navigator.connection; return !!(n && (n.saveData || /(^|-)2g$/.test(n.effectiveType || ''))); } catch (e) { return false; } };
  async function fn(action, body) {
    const c = sb(); if (!c || !c.functions) throw new Error('nofn');
    const r = await c.functions.invoke('talkie', { body: Object.assign({ action, channel: ST.key }, body || {}) });
    if (r.error) throw r.error;
    return r.data || {};
  }
  const serial = f => { const p = D.q.then(f); D.q = p.catch(() => {}); return p; };
  /* Toute erreur du direct est silencieuse : on bascule en messages vocaux, sans message effrayant. */
  async function startDirect() {
    const key = ST.key, gen = ++D.gen;
    if (!key || D.pc || typeof RTCPeerConnection === 'undefined') return;
    if (weakNet()) { note(t('weak'), 5000); return; }
    try {
      const j = await fn('join'); if (gen !== D.gen || key !== ST.key) return;
      D.tickMs = j.tickMs >= 60000 && j.tickMs <= 600000 ? j.tickMs : 60000; // test-71 : ancien serveur (1 min par comptage) → toutes les minutes
      if (!j.ok || !j.configured) { if (j.ok) D.configured = false; return; } // pas configuré ou quota atteint : mode B, plus d'essais
      const s = await fn('session'); if (gen !== D.gen) return;
      if (s && s.why === 'quota') { quotaStop(); return; }        // A5 : quota revérifié par le serveur à la création de session
      if (!s.ok || !s.sessionId) throw new Error('session');
      D.sid = s.sessionId;
      const pc = new RTCPeerConnection({ iceServers: j.iceServers || [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' });
      D.pc = pc;
      pc.ontrack = onRemoteTrack;
      pc.onconnectionstatechange = () => {
        if (D.pc !== pc) return;
        if (pc.connectionState === 'connected') { D.ready = true; D.tries = 0; track(); calcStatus(); startTicks(); }
        else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') directDown('pc-' + pc.connectionState);
        else if (pc.connectionState === 'disconnected') setTimeout(() => { if (D.pc === pc && pc.connectionState === 'disconnected') directDown('pc-disconnected'); }, 4000);
      };
      // Piste « silencieuse » (aucun micro ouvert) : elle sert à ouvrir la session ; on la remplace par null aussitôt (plus rien n'est envoyé)
      if (!actx) unlock();
      const dest = actx && actx.createMediaStreamDestination ? actx.createMediaStreamDestination() : null;
      if (!dest) throw new Error('noaudioctx');
      D.trans = pc.addTransceiver(dest.stream.getAudioTracks()[0], { direction: 'sendonly' });
      await serial(async () => {
        const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
        const r = await fn('push', { sessionId: D.sid, offer: { type: 'offer', sdp: offer.sdp }, tracks: [{ trackName: D.tn, mid: D.trans.mid }] });
        if (!r.ok || !r.sessionDescription) throw new Error('push');
        if (r.tracks && r.tracks[0] && r.tracks[0].errorCode) throw new Error('push-track');
        await pc.setRemoteDescription(r.sessionDescription);
      });
      try { await D.trans.sender.replaceTrack(null); } catch (e) {}
      // Si la connexion ne s'établit pas en 8 s : repli messages vocaux
      setTimeout(() => { if (D.pc === pc && !D.ready) directDown('timeout'); }, 8000);
    } catch (e) { warn('direct indisponible, messages vocaux', e && e.message); directDown('erreur'); }
  }
  /* Coupe-circuit (A5, 31/10) : le serveur compte 5 minutes de direct à chaque « tick ».
     - premier tick dès la connexion (minutes comptées d'avance), puis un toutes les 5 minutes ;
     - quota atteint (stop) : retour aux messages vocaux, plus d'essais du direct dans ce canal ;
     - 2 ticks ratés d'affilée (réseau, serveur) : on coupe aussi le direct, car on ne sait plus compter ce qu'il consomme.
       Le direct sera retenté plus tard (directDown), et la reprise repasse par « join » qui revérifie le quota. */
  const TICK_MS = 5 * 60000, TICK_FAILS_MAX = 2;
  function quotaStop() { D.configured = false; directDown('quota'); }
  function tickOnce() {
    if (!D.ready || !D.sid) return Promise.resolve();
    const gen = D.gen;
    const fail = () => { if (gen !== D.gen) return; D.tickFails = (D.tickFails || 0) + 1; if (D.tickFails >= TICK_FAILS_MAX) directDown('tick-echec'); };
    return fn('tick', { sessionId: D.sid }).then(r => {
      if (gen !== D.gen) return;
      if (r && (r.stop || r.why === 'quota')) { quotaStop(); return; }
      if (!r || !r.ok) { fail(); return; }
      D.tickFails = 0;
    }).catch(fail);
  }
  function startTicks() {
    clearInterval(D.tick); D.tickFails = 0;
    tickOnce();
    D.tick = setInterval(tickOnce, D.tickMs || TICK_MS);
  }
  function directDown(why) {
    clearInterval(D.tick); D.tick = null; D.tickFails = 0;
    const was = D.ready; D.ready = false; D.gen++;
    try { D.pc && D.pc.close(); } catch (e) {}
    Object.keys(D.peers).forEach(k => { try { D.peers[k].el && D.peers[k].el.remove(); } catch (e) {} }); D.peers = {};
    D.pc = null; D.trans = null; D.sid = '';
    track(); calcStatus();
    clearTimeout(D.retry);
    // Nouvel essai du direct, de plus en plus espacé (45 s, 90 s, … 5 min) tant qu'on est dans le canal
    if (ST.key && why !== 'leave' && D.tries < 6 && !(D.configured === false)) { D.tries++; D.retry = setTimeout(() => { if (ST.key && !ST.talking && !ST.starting) startDirect(); }, Math.min(300000, 45000 * D.tries)); }
    if (was) warn('direct perdu', why);
  }
  function onPresence() {
    if (!D.ready || !D.pc) return;
    const here = {};
    presList().forEach(p => { if (p.uid && p.uid !== myId() && p.direct && p.sid) here[p.sid] = p; });
    Object.keys(here).forEach(sid => { if (!D.peers[sid]) pullPeer(here[sid]); });
    Object.keys(D.peers).forEach(sid => { if (!here[sid]) { try { D.peers[sid].el && D.peers[sid].el.remove(); } catch (e) {} delete D.peers[sid]; } });
  }
  function pullPeer(p) {
    const pc = D.pc, peer = D.peers[p.sid] = { uid: p.uid, mid: null, el: null };
    serial(async () => {
      if (D.pc !== pc) return;
      const r = await fn('pull', { sessionId: D.sid, remote: { sessionId: p.sid, trackName: p.tn || 'mic' } });
      if (r && r.why === 'quota') { if (D.pc === pc) quotaStop(); return; } // A5 : quota revérifié à chaque écoute
      if (!r.ok) throw new Error('pull');
      peer.mid = r.tracks && r.tracks[0] && r.tracks[0].mid;
      if (r.requiresImmediateRenegotiation && r.sessionDescription) {
        await pc.setRemoteDescription(r.sessionDescription);
        const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
        const rr = await fn('renegotiate', { sessionId: D.sid, answer: { type: 'answer', sdp: ans.sdp } });
        if (!rr.ok) throw new Error('renegotiate');
      }
    }).catch(e => { warn('écoute du pair impossible', e && e.message); delete D.peers[p.sid]; });
  }
  function onRemoteTrack(ev) {
    const peer = Object.keys(D.peers).map(k => D.peers[k]).find(p => p.mid && ev.transceiver && ev.transceiver.mid === p.mid) || Object.keys(D.peers).map(k => D.peers[k]).find(p => !p.el);
    if (!peer) return;
    const el = document.createElement('audio'); el.autoplay = true; el.setAttribute('playsinline', ''); el.style.display = 'none';
    el.srcObject = new MediaStream([ev.track]); if (ST.volOk) el.volume = ST.vol;
    document.body.appendChild(el); peer.el = el; el.play().catch(() => { ST.unlockNeeded = true; refresh(); });
  }
  const directReady = () => !!(D.ready && D.pc && D.trans && D.pc.connectionState === 'connected');

  /* ------------------------------------------------------------------ Parler : appui, maintien, bascule ------------------------------------------------------------------ */
  async function startTalk(how) {
    if (ST.talking || ST.starting) return;
    unlock();
    if (!ST.key) { if (ST.sel) join(ST.sel); return; }
    if (floorBusy()) { beep('busy'); note(t('busy', { n: (floor && floor.name) || (ST.speaker && ST.speaker.name) || '' }), 3000); return; }
    const id = ++pressId; ST.starting = true; ST.how = how; ST.live = false;
    claim(); refresh();
    let stream;
    try { stream = await getMic(); }
    catch (e) { ST.starting = false; releaseFloor(); beep('busy'); note(t('err_mic'), 9000); refresh(); return; }
    if (id !== pressId || !ST.starting) { ST.starting = false; releaseFloor(); micIdleLater(); refresh(); return; } // relâché ou perdu avant que le micro soit prêt
    let live = directReady();
    if (live) { try { await D.trans.sender.replaceTrack(stream.getAudioTracks()[0]); } catch (e) { live = false; } }
    if (id !== pressId) { try { live && D.trans.sender.replaceTrack(null); } catch (e) {} ST.starting = false; releaseFloor(); refresh(); return; }
    ST.live = live;
    if (!live || nonDirectPeers() > 0) rec = startRec(stream); else rec = null;
    ST.starting = false; ST.talking = true; ST.t0 = Date.now();
    if (live) sendFloor({ t: 'claim', mode: 'live' });    // précise « direct » pour les auditeurs
    beep('start'); setSpeaker({ uid: myId(), name: myNameNow(), self: true, mode: live ? 'live' : 'rec' });
    clearTimeout(ST.maxTimer); ST.maxTimer = setTimeout(() => { if (ST.talking) { stopTalk('max'); note(t('max'), 4000); } }, MAX_MS);
    emit('state', API.state()); refresh();
  }
  function stopTalk(reason, discard) {
    if (!ST.talking && !ST.starting) return;
    const was = ST.talking; pressId++; ST.starting = false; ST.talking = false; clearTimeout(ST.maxTimer);
    if (ST.live) { try { D.trans && D.trans.sender.replaceTrack(null); } catch (e) {} }
    const r = rec; rec = null; stopRec(r, discard);
    releaseFloor();
    if (was) { beep('end'); if (ST.speaker && ST.speaker.self) setSpeaker(null); }
    ST.live = false; micIdleLater(); natState(); emit('state', API.state()); refresh(); setTimeout(pump, 100);
  }

  /* ------------------------------------------------------------------ Rejoindre / quitter un canal ------------------------------------------------------------------ */
  async function loadName() {
    if (ST.myName) return;
    try { const c = sb(), u = me(); if (!c || !u) return; const r = await c.from('profiles').select('first_name').eq('id', u.id).maybeSingle(); if (r && r.data && r.data.first_name) ST.myName = String(r.data.first_name).slice(0, 40); track(); } catch (e) {}
  }
  const nat = () => { try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.MrTalkie) || null; } catch (e) { return null; } };
  function natCall(m, a) { try { const p = nat(); if (p && typeof p[m] === 'function') { const r = p[m](a); if (r && r.catch) r.catch(() => {}); } } catch (e) {} }
  let lastPurge = parseInt(lsGet('mr_tk_purge', '0'), 10) || 0;
  function purgeMaybe() { if (Date.now() - lastPurge < 30 * 60000) return; lastPurge = Date.now(); lsSet('mr_tk_purge', String(lastPurge)); try { const c = sb(); c && c.functions && c.functions.invoke('talkie', { body: { action: 'purge' } }).catch(() => {}); } catch (e) {} }
  async function join(key) {
    if (!key || !me() || !sb()) return false;
    unlock();
    if (ST.key === key) return true;
    if (ST.key) leave(true);
    ST.key = key; ST.sel = key; lsSet('mr_tk_ch', key); ST.connectedOnce = false; D.tries = 0; D.configured = undefined;
    seen.clear(); queue.length = 0; pending.length = 0; lastMsg = null; lastSeenAt = 0;
    setStatus('connecting'); loadName(); ensureChannels(); natCall('start', { channel: key }); purgeMaybe();
    emit('state', API.state()); return true;
  }
  function leave(keepNative) {
    if (ST.talking || ST.starting) stopTalk('leave', true);
    clearTimeout(D.retry); directDown('leave');
    teardownChannels(); try { aud && aud.pause(); } catch (e) {}
    queue.length = 0; if (ST.speaker) setSpeaker(null);
    ST.key = null; ST.connectedOnce = false; natSig = '';
    if (!keepNative) natCall('stop');
    calcStatus(); emit('state', API.state());
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ST.key) { ensureChannels(); catchUp(); } });

  /* ------------------------------------------------------------------ Interface : carte « Talkie-walkie » (icône talkie dessinée) ------------------------------------------------------------------ */
  const CSS = `
  .mr-tk [hidden]{display:none!important}
  .mr-tk .tk-h{display:flex;align-items:center;gap:8px}
  .mr-tk .tk-h .tk-ico{color:var(--acc);flex:none}
  .mr-tk .tk-st{display:flex;align-items:center;gap:8px;font-weight:600;margin:2px 0 6px}
  .mr-tk .tk-dot{width:10px;height:10px;border-radius:50%;background:var(--mute);flex:none}
  .mr-tk[data-st=direct] .tk-dot{background:#3cc4b6;box-shadow:0 0 0 3px rgba(60,196,182,.28)}
  .mr-tk[data-st=messages] .tk-dot{background:var(--acc);box-shadow:0 0 0 3px rgba(242,183,5,.25)}
  .mr-tk[data-st=offline] .tk-dot{background:#e5484d}
  .mr-tk[data-st=connecting] .tk-dot{background:var(--mute);animation:tkblink 1s infinite}
  .mr-tk .tk-lb{margin-top:6px}
  .mr-tk select{min-height:48px}
  .mr-tk .tk-ptt{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:100%;min-height:132px;margin:12px 0 8px;padding:12px;
    border:2px solid var(--acc);border-radius:18px;background:linear-gradient(180deg,rgba(242,183,5,.18),rgba(242,183,5,.05));color:var(--ink);
    font:700 24px/1.15 'Barlow Condensed',Barlow,sans-serif;letter-spacing:.4px;text-align:center;touch-action:none;-webkit-user-select:none;user-select:none;
    -webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;cursor:pointer}
  .mr-tk .tk-ptt .tk-pi{line-height:0;color:var(--acc)}
  .mr-tk .tk-ptt.on .tk-pi{color:inherit}
  .mr-tk .tk-ptt.on{background:var(--acc);color:var(--on-acc);box-shadow:0 0 0 4px rgba(242,183,5,.35),0 0 26px rgba(242,183,5,.4);animation:tkpulse 1.4s ease-in-out infinite}
  .mr-tk .tk-ptt.busy,.mr-tk .tk-ptt.play{border-style:dashed;opacity:.7}
  .mr-tk .tk-ptt.join{background:none}
  .mr-tk .tk-ptt:focus-visible{outline:3px solid var(--acc);outline-offset:3px}
  .mr-tk .tk-who{min-height:24px;font-weight:600;text-align:center}
  .mr-tk .tk-who.sp{color:var(--ok)}
  .mr-tk .tk-opts{display:flex;flex-wrap:wrap;gap:10px 18px;align-items:center;margin-top:8px}
  .mr-tk .tk-opts label{margin:0;display:flex;align-items:center;gap:8px;font-weight:500}
  .mr-tk .tk-opts input[type=range]{width:140px;padding:0;border:0;background:none}
  .mr-tk .tk-opts input[type=checkbox]{width:22px;height:22px;flex:none}
  .mr-tk .tk-pend{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
  .mr-tk .tk-pend button,.mr-tk .tk-unl{min-height:44px}
  .mr-tk .tk-unl{width:100%;margin-top:6px}
  .mr-tk .tk-note{margin-top:6px}
  .mr-tk .tk-err{color:#e5484d;font-weight:600}
  @keyframes tkpulse{0%,100%{box-shadow:0 0 0 4px rgba(242,183,5,.35),0 0 18px rgba(242,183,5,.3)}50%{box-shadow:0 0 0 8px rgba(242,183,5,.18),0 0 32px rgba(242,183,5,.5)}}
  @keyframes tkblink{50%{opacity:.25}}
  @media (prefers-reduced-motion:reduce){.mr-tk .tk-ptt.on,.mr-tk[data-st=connecting] .tk-dot{animation:none}}`;
  /* Icône talkie-walkie (antenne, bouton de côté, grille du haut-parleur), même style au trait que la barre du bas */
  const ICON = '<svg class="tk-ico" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 7V1.8"/><rect x="7" y="7" width="10" height="15" rx="2.2"/><path d="M7 10.5H5.8v4.5H7"/><path d="M10 11h4M10 13.2h4M10 15.4h4"/><circle cx="12" cy="19" r="0.9"/></svg>';
  function injectCss() { if (document.getElementById('mr_tk_css')) return; const s = document.createElement('style'); s.id = 'mr_tk_css'; s.textContent = CSS; document.head.appendChild(s); }

  function mkCard(ctx) { const el = document.createElement('div'); el.className = 'card mr-tk'; el.dataset.ctx = ctx.kind; el.dataset.key = ctx.key || ''; el.dataset.reason = ctx.reason || ''; paint(el, true); return el; }
  function structSig(el) {
    const ch = channels(); return [LG(), me() ? 1 : 0, ch.map(c => c.key + c.label).join('|'), el.dataset.key, el.dataset.reason, ST.volOk ? 1 : 0, nat() ? 1 : 0].join('~');
  }
  function build(el) {
    const ch = channels(), ctxKey = el.dataset.key;
    let body;
    if (!me()) body = `<div class="meta">${esc(t('login'))}</div>`;
    else if (el.dataset.reason === 'ride') body = `<div class="meta">${esc(t('ride_only'))}</div>`;
    else if (el.dataset.reason === 'local') body = `<div class="meta">${esc(t('local_grp'))}</div>`;
    else if (!ch.length && !ctxKey) body = `<div class="meta">${esc(t('none'))}</div>`;
    else {
      const opts = ch.map(c => `<option value="${esc(c.key)}">${c.kind === 'g' ? '🏍 ' : '🚩 '}${esc(c.label)}${c.now ? ' · ' + esc(t('today')) : ''}</option>`).join('');
      body = `<div class="tk-st"><span class="tk-dot"></span><span class="tk-stt"></span></div>
<label class="tk-lb">${esc(t('chan'))}</label><select class="tk-sel" aria-label="${esc(t('chan'))}">${opts}</select>
<button type="button" class="tk-ptt" aria-pressed="false"><span class="tk-pi">${ICON.replace('width="24" height="24"', 'width="44" height="44"')}</span><span class="tk-pt"></span></button>
<div class="tk-who" role="status" aria-live="polite"></div>
<div class="tk-pend"></div>
<button type="button" class="g tk-unl" hidden>${esc(t('unlock'))}</button>
<div class="tk-opts"><label>${ST.volOk ? esc(t('vol')) + ' <input type="range" class="tk-v" min="0" max="100" step="5" aria-label="' + esc(t('vol')) + '">' : ''}</label>
<label><input type="checkbox" class="tk-auto"> ${esc(t('auto'))}</label></div>
<div class="row" style="justify-content:flex-start;flex-wrap:wrap;gap:8px"><button type="button" class="g tk-last">${esc(t('last'))}</button><button type="button" class="g tk-leave">${esc(t('leave'))}</button></div>
<div class="meta tk-note"></div>
<div class="meta">${esc(t('hint'))}${nat() ? ' ' + esc(t('native_note')) : ''}</div>`;
    }
    el.innerHTML = `<h3 class="tk-h">${ICON}<span>${esc(t('title'))}</span></h3>${body}`;
  }
  function paint(el, force) {
    const sig = structSig(el);
    if (force || el.dataset.sig !== sig) { build(el); el.dataset.sig = sig; el.dataset.fresh = '1'; }
    const sel = el.querySelector('.tk-sel'); if (!sel) return;
    const fresh = el.dataset.fresh === '1'; el.dataset.fresh = '';
    // canal affiché : celui de la page (groupe / sortie) la première fois, sinon le dernier choisi
    if (fresh || (document.activeElement !== sel && sel.value !== ST.sel)) {
      const want = (fresh && el.dataset.key && [...sel.options].some(o => o.value === el.dataset.key) && !ST.key) ? el.dataset.key : (ST.key || ST.sel);
      const pick = [...sel.options].find(o => o.value === want) || (fresh ? sel.options[0] : null);
      if (pick) { sel.value = pick.value; if (!ST.key) ST.sel = pick.value; }
    }
    if (el.dataset.key && !ST.key && fresh && [...sel.options].some(o => o.value === el.dataset.key)) { sel.value = el.dataset.key; ST.sel = el.dataset.key; }
    const st = ST.key ? ST.status : 'off';
    el.dataset.st = st;
    el.querySelector('.tk-stt').textContent = t('st_' + (st === 'off' ? 'off' : st === 'connecting' ? 'conn' : st === 'direct' ? 'direct' : st === 'messages' ? 'msg' : 'offline'));
    const b = el.querySelector('.tk-ptt'), pt = el.querySelector('.tk-pt'), busy = floorBusy() && !ST.talking;
    let label, cls = 'tk-ptt';
    if (!ST.key) { label = t('ptt_join'); cls += ' join'; }
    else if (st === 'connecting') { label = t('ptt_wait'); }
    else if (ST.talking || ST.starting) { label = ST.how === 'latch' ? t('ptt_latch') : t('ptt_talk'); cls += ' on'; }
    else if (busy) { const n = (floor && floor.name) || (ST.speaker && ST.speaker.name) || ''; label = ST.speaker && ST.speaker.mode === 'play' ? t('ptt_play') : t('ptt_busy', { n }); cls += ST.speaker && ST.speaker.mode === 'play' ? ' play' : ' busy'; }
    else label = t('ptt_idle');
    if (b.className !== cls) b.className = cls; if (pt.textContent !== label) pt.textContent = label;
    b.setAttribute('aria-pressed', ST.talking ? 'true' : 'false');
    const who = el.querySelector('.tk-who'), sp = ST.speaker;
    const wt = sp ? (sp.self ? t('who_me') : sp.mode === 'play' ? t('who_play', { n: sp.name }) : t('who_speaks', { n: sp.name })) : t('who_none');
    if (who.textContent !== wt) who.textContent = wt; who.classList.toggle('sp', !!sp);
    // messages à écouter (hors lecture automatique ou manqués)
    const ps = pending.map(m => m.id).join(',') + '|' + ST.auto;
    const pe = el.querySelector('.tk-pend');
    if (pe.dataset.sig !== ps) { pe.dataset.sig = ps; pe.innerHTML = pending.map(m => `<button type="button" class="g tk-pb" data-id="${esc(m.id)}">▶ ${esc(t('pend', { n: m.who }))} · ${esc(t('pend_t', { s: Math.max(1, Math.round(m.dur / 1000)) }))}</button>`).join(''); }
    const ul = el.querySelector('.tk-unl'); if (ul) ul.hidden = !ST.unlockNeeded;
    const vol = el.querySelector('.tk-v'); if (vol && document.activeElement !== vol) vol.value = Math.round(ST.vol * 100);
    const au = el.querySelector('.tk-auto'); if (au) au.checked = ST.auto;
    el.querySelector('.tk-leave').hidden = !ST.key; el.querySelector('.tk-last').hidden = !lastMsg;
    const nt = el.querySelector('.tk-note');
    const nmsg = ST.note || (ST.key ? (st === 'direct' ? t('note_direct') : st === 'messages' ? t('note_b') : '') : '');
    nt.textContent = nmsg; nt.className = 'meta tk-note' + (ST.note && /mic|Micro|ميكرو|denied|refus|رفض|Trop|كثيرة|Too many/.test(ST.note) ? ' tk-err' : '');
  }
  function refresh() { document.querySelectorAll('.mr-tk').forEach(el => { try { paint(el, false); } catch (e) { warn('paint', e); } }); }
  setInterval(() => { if (ST.key || ST.speaker) refresh(); }, 1500);

  /* Gestes : un appui long = parler tant qu'on tient ; un appui bref (< 350 ms) = démarrer, puis un 2ᵉ appui = arrêter */
  let downAt = 0, ignoreUp = false, activePtr = null;
  function pressDown(e) {
    const b = e.target.closest && e.target.closest('.mr-tk .tk-ptt'); if (!b) return;
    e.preventDefault(); unlock();
    if (e.pointerId != null) { activePtr = e.pointerId; try { b.setPointerCapture(e.pointerId); } catch (x) {} }
    if (!ST.key) { join(ST.sel); return; }
    if (ST.talking && ST.how === 'latch') { stopTalk('tap'); ignoreUp = true; return; }
    pressing = true; downAt = Date.now(); ignoreUp = false; startTalk('hold');
  }
  function pressUp(e) {
    if (e && e.pointerId != null && activePtr != null && e.pointerId !== activePtr) return;
    if (!pressing && !ignoreUp) return;
    activePtr = null;
    const wasPressing = pressing; pressing = false;
    if (ignoreUp) { ignoreUp = false; }
    else if (wasPressing && (ST.talking || ST.starting) && ST.how === 'hold') {
      if (Date.now() - downAt < TAP_MS) { ST.how = 'latch'; refresh(); }   // appui bref : on continue de parler jusqu'au prochain appui
      else stopTalk('release');
    }
    if (deferredRender) { deferredRender = false; try { render(); } catch (x) {} }
  }
  document.addEventListener('pointerdown', pressDown, true);
  window.addEventListener('pointerup', pressUp, true);
  window.addEventListener('pointercancel', pressUp, true);
  window.addEventListener('blur', () => { if (pressing) pressUp(null); });
  document.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('.mr-tk .tk-ptt')) e.preventDefault(); });
  // Clavier (accessibilité) : Espace / Entrée = maintenir pour parler
  document.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && e.target.classList && e.target.classList.contains('tk-ptt')) { e.preventDefault(); if (!ST.key) { unlock(); join(ST.sel); return; } if (ST.talking && ST.how === 'latch') { stopTalk('key'); return; } pressing = true; downAt = Date.now(); startTalk('hold'); } });
  document.addEventListener('keyup', e => { if ((e.key === ' ' || e.key === 'Enter') && e.target.classList && e.target.classList.contains('tk-ptt')) { e.preventDefault(); if (pressing) pressUp(null); } });
  document.addEventListener('change', e => {
    const el = e.target; if (!el.closest || !el.closest('.mr-tk')) return;
    if (el.classList.contains('tk-sel')) { ST.sel = el.value; lsSet('mr_tk_ch', ST.sel); unlock(); join(el.value); }
    else if (el.classList.contains('tk-auto')) { ST.auto = el.checked; lsSet('mr_tk_auto', ST.auto ? '1' : '0'); refresh(); }
  });
  document.addEventListener('input', e => { const el = e.target; if (el.classList && el.classList.contains('tk-v')) { ST.vol = Math.min(1, Math.max(0, el.value / 100)); lsSet('mr_tk_vol', String(ST.vol)); applyVolume(); } });
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.mr-tk button'); if (!b) return;
    if (b.classList.contains('tk-leave')) leave();
    else if (b.classList.contains('tk-last')) replayLast();
    else if (b.classList.contains('tk-pb')) playPending(b.dataset.id);
    else if (b.classList.contains('tk-unl')) { unlock(); ST.unlockNeeded = false; refresh(); pump(); }
  });

  /* ------------------------------------------------------------------ Branchements dans l'app (sans toucher à son code) ------------------------------------------------------------------ */
  function placeCard(m, ctx) {
    let el = m.querySelector(':scope > .mr-tk'); if (el) return;
    el = mkCard(ctx); const first = m.querySelector(':scope > .card'); if (first) first.after(el); else m.prepend(el);
  }
  function inject() {
    const m = document.getElementById('main'); if (!m) return;
    const tb = typeof tab !== 'undefined' ? tab : 0;
    if (tb === 6) placeCard(m, { kind: 'route' });
    else if (tb === 3 && typeof gid !== 'undefined' && gid) {
      const s = gS(), g = s && (s.groups || []).find(x => x.id == gid);
      placeCard(m, { kind: 'group', key: g && g.srv && uuidRe.test(g.uid || '') && (g.me || g.owner) ? 'g:' + String(g.uid).toLowerCase() : '', reason: g && !g.srv ? 'local' : '' });
    }
  }
  function hook() {
    try {
      if (typeof render === 'function' && !render.__tk) {
        const _r = render;
        render = function () {
          if (pressing) { deferredRender = true; return; }          // on ne redessine pas sous le doigt pendant un appui
          const r = _r.apply(this, arguments); try { inject(); } catch (e) { warn('inject', e); } return r;
        };
        render.__tk = true;
        try { inject(); } catch (e) {}
      }
      if (typeof showSortie === 'function' && !showSortie.__tk) {
        const _s = showSortie;
        showSortie = function (id) {
          const r = _s.apply(this, arguments);
          try {
            const s = gS(), x = s && (s.sorties || []).find(v => v.id == id), box = document.getElementById('sd_b');
            if (x && box) {
              const ok = x.srv && uuidRe.test(x.uid || '') && (x.joined || x.creator);
              box.appendChild(mkCard({ kind: 'ride', key: ok ? 'r:' + String(x.uid).toLowerCase() : '', reason: x.srv ? (ok ? '' : 'ride') : 'ride' }));
            }
          } catch (e) { warn('sortie', e); }
          return r;
        };
        showSortie.__tk = true;
      }
    } catch (e) { warn('hook', e); }
  }

  /* ------------------------------------------------------------------ API publique ------------------------------------------------------------------ */
  const API = {
    version: '1.0',
    pttDown() { pressing = false; unlock(); return startTalk('hold'); },                 // casque / service natif : début de parole
    pttUp() { if (ST.talking || ST.starting) stopTalk('up'); },                           // fin de parole
    toggle() { unlock(); if (ST.talking || ST.starting) stopTalk('toggle'); else startTalk('latch'); },
    join, leave: () => leave(),
    on(ev, f) { (listeners[ev] = listeners[ev] || []).push(f); return () => API.off(ev, f); },
    off(ev, f) { listeners[ev] = (listeners[ev] || []).filter(x => x !== f); },
    setVolume(v) { ST.vol = Math.min(1, Math.max(0, +v || 0)); lsSet('mr_tk_vol', String(ST.vol)); applyVolume(); refresh(); },
    setAuto(b) { ST.auto = !!b; lsSet('mr_tk_auto', ST.auto ? '1' : '0'); refresh(); },
    state() { return { channel: ST.key, mode: ST.key ? ST.status : 'off', talking: ST.talking, starting: ST.starting, live: ST.live, speaker: ST.speaker ? { name: ST.speaker.name, self: !!ST.speaker.self, mode: ST.speaker.mode } : null, volume: ST.vol, auto: ST.auto, pending: pending.length, queued: queue.length, outbox: outbox.length, peers: presList().length }; },
    channels, refresh, cardHtml: () => '<div class="card mr-tk" data-ctx="route"></div>',
  };
  window.MrTalkie = API;
  /* Le service natif appelle lui-même MrTalkie.toggle() / pttUp() juste après cet événement : ici on ne refait PAS toggle()
     (sinon le micro s'ouvre puis se ferme aussitôt). On traite seulement l'arrêt du service (bouton « Arrêter » de la notification…). */
  window.addEventListener('mr-talkie-native', e => { const d = (e && e.detail) || {}; if (d.type === 'stop' && ST.key) leave(true); });
  window.addEventListener('offline', calcStatus); window.addEventListener('online', calcStatus);
  injectCss(); hook();
  // les autres modules (itineraire.js…) chaînent aussi render : on se ré-accroche une fois tout chargé
  window.addEventListener('load', () => setTimeout(() => { hook(); refresh(); }, 0));
})();
