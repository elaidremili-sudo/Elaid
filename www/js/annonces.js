/* MotoRoute – Annonces des membres sur le serveur (test-57, 24/10/2026)
   Bug signalé par Elaid : une annonce (GSX-R) publiée sur le compte d'Ali n'apparaissait pas sur son téléphone.
   Cause : les annonces étaient gardées seulement dans la mémoire du téléphone qui les publiait.
   Maintenant elles sont sur Supabase (table « annonces », script supabase/annonces.sql) et tout membre les voit.
   L'onglet Annonces a deux parties : « Annonces des membres » et « Vitrines des pros » (partenaires).
   Contact du vendeur par WhatsApp ou appel ; Vendu, Prolonger, Supprimer pour l'auteur ;
   Signaler (3 membres = masquée) ; l'administrateur peut tout supprimer ou réafficher. */
(function () {
  'use strict';
  const W = (f, a, e) => (lang == 'ar' ? a : lang == 'en' ? e : f);
  const sbc = () => window.mrSb || null, me = () => (window.mrUser && window.mrUser()) || null;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAXP = 4, BUCKET = 'annonce-photos', FK = 'mr_ads_fav', TK = 'mr_ads_tel';
  const COLS = 'id,user_id,author,ty,cat,title,descr,price,city,phone,year,km,papers,papers_note,photos,sold,reports,hidden,created_at,expires_at';

  let sub = 'm', fT = 'all', fC = 'all', fMine = false, fFav = false, q = '';
  let items = [], loadedAt = 0, loading = false, err = '', admin = false, loadUid = null, busy = false;
  let fav = []; try { fav = JSON.parse(localStorage.getItem(FK) || '[]'); if (!Array.isArray(fav)) fav = []; } catch (e) { fav = []; }
  let photos = [];

  /* Libellés du formulaire (boîte d2) + aide */
  try {
    Object.assign(L.fr, { gear: 'Équipement (casque, blouson…)', a_tel: 'Téléphone / WhatsApp pour être contacté', photos: 'Photos', gal: '🖼 Galerie', cam: '📷 Prendre une photo',
      hp2: 'Onglet Annonces → « Annonces des membres » : touchez « ＋ Publier une annonce » (moto, pièce ou équipement), ajoutez jusqu’à 4 photos depuis la Galerie de votre téléphone et votre numéro. Tous les membres la voient aussitôt et vous contactent par WhatsApp ou appel. « Vitrines des pros » : les magasins partenaires et leurs promotions.' });
    Object.assign(L.ar, { gear: 'تجهيزات (خوذة، سترة…)', a_tel: 'الهاتف / واتساب للتواصل', photos: 'الصور', gal: '🖼 المعرض', cam: '📷 التقاط صورة',
      hp2: 'تبويب الإعلانات ← «إعلانات الأعضاء»: المس «＋ نشر إعلان» (دراجة، قطعة أو تجهيزات)، أضف حتى 4 صور من معرض هاتفك ورقمك. يراه جميع الأعضاء فورًا ويتصلون بك عبر واتساب أو الهاتف. «متاجر المحترفين»: المتاجر الشريكة وعروضها.' });
    if (L.en) Object.assign(L.en, { gear: 'Gear (helmet, jacket…)', a_tel: 'Phone / WhatsApp to be contacted', photos: 'Photos', gal: '🖼 Gallery', cam: '📷 Take a photo',
      hp2: 'Ads tab → “Members’ ads”: tap “＋ Post an ad” (bike, part or gear), add up to 4 photos from your phone’s Gallery and your number. All members see it right away and contact you by WhatsApp or call. “Pro shops”: partner stores and their deals.' });
    if (typeof statics == 'function') statics();
  } catch (e) { console.warn('annonces libellés', e); }

  const notReady = e => /PGRST20[25]|42P01|42883|schema cache|does not exist|Could not find/i.test(String((e && (e.code || '')) + ' ' + (e && e.message || '')));
  const errTxt = e => notReady(e)
    ? W('Le serveur des annonces n’est pas encore prêt : exécute le script supabase/annonces.sql dans Supabase (SQL Editor).',
        'خادم الإعلانات غير جاهز بعد: نفّذ السكربت supabase/annonces.sql في Supabase.',
        'The ads server is not ready yet: run supabase/annonces.sql in Supabase (SQL Editor).')
    : /Limite atteinte/.test(String(e && e.message)) ? W('Limite atteinte : 10 annonces par 24 h.', 'الحد الأقصى: 10 إعلانات في 24 ساعة.', 'Limit reached: 10 ads per 24 h.')
    : W('Impossible pour l’instant (internet ?).', 'غير ممكن الآن (الإنترنت؟).', 'Not possible right now (internet?).');
  const redraw = () => { try { if (tab == 2) render(); } catch (e) {} };

  async function load(force) {
    const c = sbc(), u = me(); if (!c || !u || loading) return;
    if (!force && u.id === loadUid && Date.now() - loadedAt < 30000) return;
    loading = true; loadUid = u.id;
    try {
      const r = await c.from('annonces').select(COLS).order('created_at', { ascending: false }).limit(300);
      if (r.error) throw r.error;
      items = r.data || []; err = ''; loadedAt = Date.now();
      try { const a = await c.rpc('mr_is_admin'); admin = !a.error && a.data === true; } catch (e) { admin = false; }
    } catch (e) { err = errTxt(e); loadedAt = Date.now() - 20000; }
    loading = false; redraw();
  }
  window.mrAdsReload = () => load(true);
  setInterval(() => { try { if (tab == 2 && sub == 'm' && document.visibilityState == 'visible') load(); } catch (e) {} }, 30000);

  const telWa = p => { let d = String(p || '').replace(/\D/g, ''); if (/^0[5-7]\d{8}$/.test(d)) d = '213' + d.slice(1); return d; };
  const money = n => (Number(n) || 0).toLocaleString(lang == 'ar' ? 'ar-DZ' : lang == 'en' ? 'en-GB' : 'fr-FR') + ' ' + T().cur;
  const ago = s => {
    const d = Math.floor((Date.now() - new Date(s).getTime()) / 864e5);
    return d <= 0 ? W('aujourd’hui', 'اليوم', 'today') : d == 1 ? W('hier', 'أمس', 'yesterday') : W('il y a ' + d + ' j', 'منذ ' + d + ' يوم', d + ' days ago');
  };
  const daysLeft = a => Math.ceil((new Date(a.expires_at).getTime() - Date.now()) / 864e5);
  const catLab = c => c == 'moto' ? T().moto : c == 'part' ? T().part : W('Équipement', 'تجهيزات', 'Gear');
  const ppLab = { clean: () => T().pp_clean, issue: () => T().pp_issue, none: () => T().pp_none };

  function card(a) {
    const u = me(), mine = !!(u && a.user_id == u.id), t = T();
    const ph = (a.photos || []).filter(Boolean);
    const wa = telWa(a.phone), msg = W('Bonjour, je suis intéressé par votre annonce « {t} » sur MotoRoute.', 'مرحبًا، أنا مهتم بإعلانك «{t}» على MotoRoute.', 'Hello, I am interested in your ad “{t}” on MotoRoute.').replace('{t}', a.title);
    const left = daysLeft(a);
    return `<div class="card ad-card${a.sold ? ' ad-sold' : ''}">
    ${ph.length ? `<div class="ad-phs">${ph.map((p, i) => `<img src="${esc(p)}" alt="" loading="lazy" data-adbig="${esc(a.id)}|${i}">`).join('')}</div>` : ''}
    <span class="tag ${a.ty == 'sell' ? 'v' : 'a'}">${a.ty == 'sell' ? t.forsale : t.wanted}</span><span class="tag">${esc(catLab(a.cat))}</span>
    ${a.sold ? `<span class="tag" style="background:#3fb950;color:#06130a">✅ ${W('Vendu', 'تم البيع', 'Sold')}</span>` : ''}
    ${a.hidden ? `<span class="tag" style="background:#ff6b6b;color:#fff">🚩 ${W('Masquée (signalements)', 'مخفي (بلاغات)', 'Hidden (reports)')}</span>` : ''}
    <h3 style="margin-top:8px">${esc(a.title)}</h3>
    ${a.descr ? `<div class="meta" style="white-space:pre-line">${esc(a.descr)}</div>` : ''}
    ${a.cat == 'moto' && (a.year || a.km || a.papers) ? `<div class="meta">${a.year ? '📅 ' + esc(a.year) : ''}${a.km != null && a.km !== '' ? ' · 🛣 ' + Number(a.km).toLocaleString(t.loc) + ' km' : ''}${a.papers && ppLab[a.papers] ? ' · 📄 ' + esc(ppLab[a.papers]()) : ''}</div>${a.papers_note ? `<div class="meta">${esc(a.papers_note)}</div>` : ''}` : ''}
    <div class="row"><span class="price">${a.price ? money(a.price) : t.nego}</span><span class="meta">📍 ${esc(a.city || '—')}</span></div>
    <div class="meta">👤 ${esc(a.author || W('Membre', 'عضو', 'Member'))} · ${ago(a.created_at)}${mine ? ` · ⏳ ${left > 0 ? W('encore ' + left + ' j', 'متبقٍّ ' + left + ' يوم', left + ' days left') : W('expirée', 'منتهي', 'expired')}` : ''}</div>
    <div class="row ad-act" style="flex-wrap:wrap;justify-content:flex-start;gap:8px">
      ${!mine && wa ? `<a class="ad-btn wa" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}">💬 WhatsApp</a>` : ''}
      ${!mine && a.phone ? `<a class="ad-btn" href="tel:${esc(String(a.phone).replace(/[^\d+]/g, ''))}">📞 ${W('Appeler', 'اتصال', 'Call')}</a>` : ''}
      ${!mine ? `<button class="g" data-adfav="${esc(a.id)}">${fav.includes(a.id) ? '♥' : '♡'}</button>` : ''}
      ${!mine && !a.hidden ? `<button class="g" data-adrep="${esc(a.id)}">🚩 ${t.rep}</button>` : ''}
      ${mine ? `<button class="g" data-adsold="${esc(a.id)}">${a.sold ? W('↩ Remettre en vente', '↩ إعادة العرض', '↩ Back on sale') : W('✅ Vendu', '✅ تم البيع', '✅ Sold')}</button>` : ''}
      ${mine && left < 20 ? `<button class="g" data-adext="${esc(a.id)}">🔄 ${W('Prolonger 60 j', 'تمديد 60 يومًا', 'Extend 60 d')}</button>` : ''}
      ${admin && a.hidden ? `<button class="g" data-adunhide="${esc(a.id)}">👁 ${W('Réafficher', 'إظهار', 'Unhide')}</button>` : ''}
      ${mine || admin ? `<button class="g" data-addel="${esc(a.id)}">🗑 ${t.del}</button>` : ''}
    </div></div>`;
  }

  function membersHtml(t) {
    load();
    const u = me(), ql = q.toLowerCase();
    const l = items.filter(a => (fT == 'all' || a.ty == fT) && (fC == 'all' || a.cat == fC) && (!fMine || (u && a.user_id == u.id)) && (!fFav || fav.includes(a.id))
      && (fMine || !a.hidden || admin) && (fMine || new Date(a.expires_at) > new Date() || admin)
      && (!ql || (a.title + ' ' + a.descr + ' ' + a.city + ' ' + a.author).toLowerCase().includes(ql)));
    const chip = (on, data, lab) => `<button class="g ${on ? 'on' : ''}" ${data}>${lab}</button>`;
    return `<button class="p" style="width:100%;margin:2px 0 10px;padding:12px" data-adnew="1">＋ ${W('Publier une annonce (moto, pièce, équipement)', 'نشر إعلان (دراجة، قطعة، تجهيزات)', 'Post an ad (bike, part, gear)')}</button>
    <div class="card ad-tools"><input id="adq" type="search" class="srch" placeholder="${esc(t.search)}" value="${esc(q)}">
    <div class="filters">${chip(fT == 'all', 'data-adft="all"', t.all)}${chip(fT == 'sell', 'data-adft="sell"', t.forsale)}${chip(fT == 'buy', 'data-adft="buy"', t.wanted)}</div>
    <div class="filters">${chip(fC == 'all', 'data-adfc="all"', t.all)}${chip(fC == 'moto', 'data-adfc="moto"', t.moto)}${chip(fC == 'part', 'data-adfc="part"', t.part)}${chip(fC == 'gear', 'data-adfc="gear"', W('Équipement', 'تجهيزات', 'Gear'))}${chip(fFav, 'data-adff="1"', '♥ ' + t.fav)}${chip(fMine, 'data-adfm="1"', '👤 ' + W('Mes annonces', 'إعلاناتي', 'My ads'))}</div></div>
    ${err ? `<div class="card"><div class="meta" style="color:#ff6b6b">${esc(err)}</div><button class="g" data-adretry="1">↻ ${W('Réessayer', 'إعادة المحاولة', 'Retry')}</button></div>` : ''}
    ${!loadedAt && !err ? `<div class="empty">${W('Chargement des annonces…', 'جارٍ تحميل الإعلانات…', 'Loading ads…')}</div>`
      : l.length ? l.map(card).join('') : `<div class="empty">${fMine ? W('Tu n’as pas encore publié d’annonce.', 'لم تنشر أي إعلان بعد.', 'You have not posted an ad yet.') : t.empty2}</div>`}
    <div class="card"><h3>${t.tips_t}</h3><div class="meta">${t.tips}</div></div>`;
  }

  /* Onglet Annonces complet : sous-onglets Membres / Pros */
  window.mrAdsTab = function (t) {
    const seg = `<div class="vt-seg vt-tabs ad-seg"><button class="${sub == 'm' ? 'on' : ''}" data-adsub="m">🏍 ${W('Annonces des membres', 'إعلانات الأعضاء', 'Members’ ads')}</button><button class="${sub == 'p' ? 'on' : ''}" data-adsub="p">🏪 ${W('Vitrines des pros', 'متاجر المحترفين', 'Pro shops')}</button></div>`;
    return seg + (sub == 'm' ? membersHtml(t) : (typeof partnersHtml == 'function' ? partnersHtml(t) : ''));
  };
  window.mrAdsSub = s => { sub = s; redraw(); };

  /* ---------- Formulaire (boîte d2) ---------- */
  function drawPhotos() {
    const box = document.getElementById('a_phs'); if (!box) return;
    box.innerHTML = photos.map((p, i) => `<div class="ad-thumb"><img src="${p}" alt=""><button type="button" data-adrmph="${i}">✕</button></div>`).join('');
    const b = document.getElementById('a_phb'); if (b) b.style.display = photos.length >= MAXP ? 'none' : '';
    const n = document.getElementById('a_phn'); if (n) n.textContent = photos.length + ' / ' + MAXP;
  }
  function openForm() {
    photos = []; ['a_t', 'a_p', 'a_de', 'a_y', 'a_k', 'a_pn'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    const tel = document.getElementById('a_tel'); if (tel && !tel.value) { try { tel.value = localStorage.getItem(TK) || ''; } catch (e) {} }
    drawPhotos(); document.getElementById('d2').showModal();
  }
  window.mrAdsOpenForm = openForm;

  async function upload(dataUrl, uid) {
    const c = sbc(), b = await (await fetch(dataUrl)).blob(), path = uid + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.jpg';
    const r = await c.storage.from(BUCKET).upload(path, b, { contentType: 'image/jpeg', upsert: false }); if (r.error) throw r.error;
    return c.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
  function rmPhotos(urls) {
    const paths = (urls || []).map(u => String(u).split('/' + BUCKET + '/')[1]).filter(Boolean).map(decodeURIComponent);
    if (paths.length && sbc()) sbc().storage.from(BUCKET).remove(paths).then(() => {}, () => {});
  }

  window.mrAdsSubmit = async function () {
    const v = id => (document.getElementById(id) || {}).value || '';
    const c = sbc(), u = me(), btn = document.getElementById('a_ok');
    if (!c || !u) { alert(W('Connecte-toi d’abord à ton compte.', 'سجّل الدخول أولًا.', 'Sign in first.')); return; }
    const title = v('a_t').trim(); if (title.length < 2) { alert(T().err2); return; }
    const tel = v('a_tel').trim();
    if (v('a_ty') == 'sell' && !tel && !confirm(W('Sans numéro, les acheteurs ne pourront pas te contacter. Publier quand même ?', 'بدون رقم لن يتمكن المشترون من الاتصال بك. النشر على أي حال؟', 'Without a number buyers cannot contact you. Post anyway?'))) return;
    if (busy) return; busy = true; const old = btn.textContent; btn.textContent = W('Envoi…', 'جارٍ الإرسال…', 'Sending…'); btn.disabled = true;
    const urls = [];
    try {
      for (const p of photos) urls.push(await upload(p, u.id));
      const num = s => { const n = parseInt(String(s).replace(/\D/g, ''), 10); return isNaN(n) ? null : n; };
      const mo = v('a_cat') == 'moto';
      const row = { ty: v('a_ty') || 'sell', cat: v('a_cat') || 'moto', title: title.slice(0, 80), descr: v('a_de').trim().slice(0, 800),
        price: num(v('a_p')) || 0, city: v('a_v').trim().slice(0, 60), phone: tel.slice(0, 25), photos: urls,
        year: mo ? num(v('a_y')) : null, km: mo ? num(v('a_k')) : null, papers: mo ? (v('a_pp') || '') : '', papers_note: mo ? v('a_pn').trim().slice(0, 300) : '' };
      const r = await c.from('annonces').insert(row); if (r.error) throw r.error;
      try { if (tel) localStorage.setItem(TK, tel); } catch (e) {}
      photos = []; document.getElementById('d2').close();
      sub = 'm'; fMine = false; fT = 'all'; fC = 'all'; fFav = false; q = '';
      await load(true);
      alert(W('✅ Annonce publiée : tous les membres la voient maintenant.', '✅ نُشر الإعلان: يراه جميع الأعضاء الآن.', '✅ Ad posted: all members can see it now.'));
    } catch (e) { rmPhotos(urls); console.error('annonce', e); alert(urls.length < photos.length ? W('La photo n’a pas pu être envoyée.', 'تعذر إرسال الصورة.', 'The photo could not be sent.') + '\n' + errTxt(e) : errTxt(e)); }
    busy = false; btn.textContent = old; btn.disabled = false;
  };

  /* ---------- Clics ---------- */
  document.addEventListener('click', async ev => {
    const el = ev.target.closest('[data-adsub],[data-adnew],[data-adft],[data-adfc],[data-adff],[data-adfm],[data-adfav],[data-adrep],[data-adsold],[data-adext],[data-addel],[data-adunhide],[data-adretry],[data-adbig],[data-adgal],[data-adcam],[data-adrmph]');
    if (!el) return;
    const d = el.dataset, c = sbc();
    if (d.adgal || d.adcam) {
      ev.preventDefault(); if (photos.length >= MAXP) return;
      try { const got = await window.mrPickPhotos(d.adgal ? 'gallery' : 'camera', MAXP - photos.length); photos = photos.concat(got).slice(0, MAXP); drawPhotos(); }
      catch (e) { alert(W('Impossible d’ouvrir les photos.', 'تعذر فتح الصور.', 'Could not open photos.')); }
      return;
    }
    if (d.adrmph !== undefined) { ev.preventDefault(); photos.splice(+d.adrmph, 1); drawPhotos(); return; }
    if (d.adbig) { const [id, i] = d.adbig.split('|'), a = items.find(x => x.id == id); if (a) big(a, +i); return; }
    ev.preventDefault(); ev.stopPropagation();
    if (d.adsub) { sub = d.adsub; redraw(); return; }
    if (d.adnew) { openForm(); return; }
    if (d.adft) { fT = d.adft; redraw(); return; }
    if (d.adfc) { fC = d.adfc; redraw(); return; }
    if (d.adff) { fFav = !fFav; redraw(); return; }
    if (d.adfm) { fMine = !fMine; redraw(); return; }
    if (d.adretry) { err = ''; load(true); return; }
    if (d.adfav) { const id = d.adfav; fav = fav.includes(id) ? fav.filter(x => x != id) : [...fav, id]; try { localStorage.setItem(FK, JSON.stringify(fav)); } catch (e) {} redraw(); return; }
    if (!c || busy) return;
    const a = items.find(x => x.id == (d.adrep || d.adsold || d.adext || d.addel || d.adunhide)); if (!a) return;
    busy = true;
    try {
      if (d.adrep) {
        if (confirm(T().rep_ask)) { const r = await c.rpc('mr_annonce_report', { p_annonce: a.id, p_reason: '' }); if (r.error) throw r.error; alert(W('Merci, annonce signalée. Au 3e signalement de membres différents, elle est masquée pour tous.', 'شكرًا، تم الإبلاغ. عند البلاغ الثالث من أعضاء مختلفين يُخفى الإعلان للجميع.', 'Thanks, ad reported. After 3 reports from different members it is hidden for everyone.')); }
      } else if (d.adsold) {
        const r = await c.from('annonces').update({ sold: !a.sold }).eq('id', a.id); if (r.error) throw r.error;
      } else if (d.adext) {
        const r = await c.from('annonces').update({ expires_at: new Date(Date.now() + 60 * 864e5).toISOString() }).eq('id', a.id); if (r.error) throw r.error;
      } else if (d.addel) {
        if (confirm(W('Supprimer cette annonce ?', 'حذف هذا الإعلان؟', 'Delete this ad?'))) { const r = await c.from('annonces').delete().eq('id', a.id); if (r.error) throw r.error; rmPhotos(a.photos); }
      } else if (d.adunhide) {
        const r = await c.rpc('mr_annonce_unhide', { p_annonce: a.id }); if (r.error) throw r.error;
      }
    } catch (e) { alert(errTxt(e)); }
    busy = false; await load(true);
  }, true);
  document.addEventListener('input', e => { if (e.target && e.target.id == 'adq') { q = e.target.value; clearTimeout(window.__adqT); window.__adqT = setTimeout(() => { redraw(); const i = document.getElementById('adq'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 350); } });

  /* Photo en grand */
  function big(a, i) {
    let dl = document.getElementById('adBig');
    if (!dl) { document.body.insertAdjacentHTML('beforeend', '<dialog id="adBig" class="mp-dlg" style="padding:0;max-width:96vw;background:#000"></dialog>'); dl = document.getElementById('adBig'); dl.onclick = () => dl.close(); }
    const ph = a.photos || [];
    dl.innerHTML = `<div style="display:flex;overflow-x:auto;scroll-snap-type:x mandatory">${ph.map(p => `<img src="${esc(p)}" alt="" style="flex:0 0 100%;max-height:85vh;object-fit:contain;scroll-snap-align:center">`).join('')}</div><div class="meta" style="text-align:center;color:#fff;padding:6px">${esc(a.title)} · ${W('touche pour fermer', 'المس للإغلاق', 'tap to close')}</div>`;
    dl.showModal(); const box = dl.firstElementChild; box.scrollLeft = box.clientWidth * i;
  }

  /* Styles */
  document.head.insertAdjacentHTML('beforeend', `<style>
  .ad-phs{display:flex;gap:6px;overflow-x:auto;margin:-2px 0 10px;scroll-snap-type:x mandatory}
  .ad-phs img{flex:0 0 auto;height:190px;max-width:88%;object-fit:cover;border-radius:12px;scroll-snap-align:start}
  .ad-phs img:only-child{max-width:100%;width:100%}
  .ad-sold{opacity:.72}
  .a-phs{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}
  .ad-thumb{position:relative;width:76px;height:76px}
  .ad-thumb img{width:100%;height:100%;object-fit:cover;border-radius:10px}
  .ad-thumb button{position:absolute;top:-6px;right:-6px;width:24px;height:24px;border-radius:50%;border:0;background:#ff6b6b;color:#fff;font-size:13px;padding:0}
  .ad-seg{display:flex;gap:4px;margin:0 0 10px;padding:4px;border-radius:14px;background:rgba(10,12,14,.82);backdrop-filter:blur(8px)}
  .ad-seg button{flex:1;font-size:13px;color:#fff;border:0;border-radius:10px;padding:10px 6px;background:transparent}
  .ad-seg button.on{background:var(--acc,#f5b301);color:#111;font-weight:700}
  .ad-tools{padding:10px 12px}.ad-tools .srch{margin:0 0 8px;width:100%}.ad-tools .filters{margin:4px 0}
  .ad-btn{display:inline-flex;align-items:center;gap:4px;padding:8px 14px;border-radius:999px;text-decoration:none;font-weight:600;background:rgba(0,0,0,.06);color:inherit;border:1px solid rgba(0,0,0,.12)}
  .ad-btn.wa{background:#25d366;color:#fff;border-color:#25d366}
  .vt-steps{margin:8px 0 10px;padding-inline-start:20px}.vt-steps li{margin:3px 0}
  .vt-pro{border:1px solid rgba(255,190,60,.55)}
  </style>`);
})();
