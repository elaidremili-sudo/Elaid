/* MotoRoute – Bonnes adresses sur la route (test-53, 24/10/2026)
   Tout membre connecté ajoute un lieu utile (hébergement / motard hôte, resto-café, station, mécanicien,
   point de vue, autre) avec sa position GPS et jusqu'à 4 photos. Visible tout de suite par les autres
   (pas de validation, décision d'Elaid). Garde-fous : 👍, « Signaler » (3 membres = masqué), suppression
   par l'auteur ou l'administrateur. Serveur : supabase/bonnes-adresses.sql. */
(function () {
  'use strict';
  const W = (f, a, e) => (lang == 'ar' ? a : lang == 'en' ? e : f);
  const sbc = () => window.mrSb || null, me = () => (window.mrUser && window.mrUser()) || null;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KINDS = [
    ['host', '🏠', () => W('Hébergement', 'مبيت', 'Lodging')],
    ['food', '🍽', () => W('Resto / café', 'مطعم / مقهى', 'Food / café')],
    ['fuel', '⛽', () => W('Station', 'محطة وقود', 'Fuel')],
    ['meca', '🔧', () => W('Mécanicien', 'ميكانيكي', 'Mechanic')],
    ['view', '🏞', () => W('Point de vue', 'منظر جميل', 'Viewpoint')],
    ['other', '📌', () => W('Autre', 'أخرى', 'Other')]
  ];
  const K = k => KINDS.find(x => x[0] == k) || KINDS[5];
  const MAXP = 4;

  let D = null, view = 'list', filt = 'all', q = '', items = [], liked = new Set(), admin = false, loaded = 0, busy = false, err = '';
  let here = null, hereAt = 0, form = null, big = null;

  /* ---------- Position ---------- */
  function locate(hi) {
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(
        p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) }),
        () => res(null), { enableHighAccuracy: !!hi, timeout: hi ? 20000 : 8000, maximumAge: hi ? 0 : 120000 });
    });
  }
  const km = (a, b) => {
    const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  const dist = d => d < 1 ? Math.round(d * 1000) + ' m' : (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km';
  const mapUrl = p => 'https://www.google.com/maps/search/?api=1&query=' + p.lat + ',' + p.lng;
  const goUrl = p => 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + p.lat + ',' + p.lng;

  /* ---------- Serveur ---------- */
  const notReady = e => /PGRST20[25]|42P01|42883|schema cache|does not exist|Could not find/i.test(String((e && (e.code || '')) + ' ' + (e && e.message || '')));
  const errTxt = e => notReady(e)
    ? W('Le serveur n’est pas encore prêt : exécute le script supabase/bonnes-adresses.sql dans Supabase (SQL Editor).',
        'الخادم غير جاهز بعد: نفّذ السكربت supabase/bonnes-adresses.sql في Supabase.',
        'The server is not ready yet: run supabase/bonnes-adresses.sql in Supabase (SQL Editor).')
    : String((e && e.message) || e || W('Erreur réseau.', 'خطأ في الشبكة.', 'Network error.'));

  async function load() {
    const c = sbc(), u = me();
    if (!c || !u) { items = []; return; }
    busy = true; err = ''; paint();
    try {
      const r = await c.from('places').select('id,user_id,author,kind,name,city,note,phone,lat,lng,photos,likes,reports,hidden,created_at')
        .order('created_at', { ascending: false }).limit(1000);
      if (r.error) throw r.error;
      items = r.data || [];
      const l = await c.from('place_likes').select('place_id').eq('user_id', u.id);
      liked = new Set(((l && l.data) || []).map(x => x.place_id));
      try { const a = await c.rpc('mr_is_admin'); admin = !!(a && a.data); } catch (e) { admin = false; }
      loaded = Date.now();
    } catch (e) { err = errTxt(e); }
    busy = false; paint();
  }

  function shrink(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const im = new Image();
        im.onload = () => {
          const sc = Math.min(1, 1280 / Math.max(im.width, im.height)), c = document.createElement('canvas');
          c.width = Math.round(im.width * sc); c.height = Math.round(im.height * sc);
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', .8));
        };
        im.onerror = rej; im.src = r.result;
      };
      r.onerror = rej; r.readAsDataURL(file);
    });
  }
  async function upload(dataUrl) {
    const c = sbc(), u = me(), b = await (await fetch(dataUrl)).blob();
    const path = u.id + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.jpg';
    const r = await c.storage.from('place-photos').upload(path, b, { contentType: 'image/jpeg', upsert: false });
    if (r.error) throw r.error;
    return c.storage.from('place-photos').getPublicUrl(path).data.publicUrl;
  }
  function rmPhotos(urls) {
    const paths = (urls || []).map(u => String(u).split('/place-photos/')[1]).filter(Boolean).map(decodeURIComponent);
    if (paths.length && sbc()) sbc().storage.from('place-photos').remove(paths).then(() => {}, () => {});
  }

  /* ---------- Affichage ---------- */
  function ensure() {
    if (D) return D;
    document.head.insertAdjacentHTML('beforeend', `<style>
.pl-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none}
.pl-chips button{flex:0 0 auto}#plD .pl-chips button.on,#plD .pl-a .on{background:var(--acc)!important;color:var(--on-acc)!important;border-color:var(--acc)!important;font-weight:700}
.pl-it{border:1px solid rgba(127,127,127,.22);border-radius:14px;overflow:hidden;margin-top:10px}
.pl-ph{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}
.pl-ph img{flex:0 0 auto;height:130px;max-width:86%;object-fit:cover;cursor:zoom-in}
.pl-ph img:only-child{width:100%;max-width:100%}
.pl-b{padding:10px 12px}.pl-t{font:700 16px Barlow,sans-serif;line-height:1.25}
.pl-n{margin:6px 0 0;white-space:pre-wrap;line-height:1.4}
.pl-a{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.pl-a .g{padding:6px 10px}
#plD .pl-a a.g{display:inline-flex;align-items:center;border:1.5px solid var(--line)!important;border-radius:99px!important;padding:6px 10px;text-decoration:none!important;color:var(--ink)!important;background:var(--card)!important;-webkit-text-fill-color:currentColor}
.pl-hid{opacity:.55}.pl-warn{font-size:12px;background:#c62828;color:#fff;border-radius:6px;padding:1px 6px}
.pl-picks{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.pl-picks div{position:relative}.pl-picks img{width:78px;height:78px;object-fit:cover;border-radius:10px;display:block}
.pl-picks button{position:absolute;top:-6px;right:-6px;width:24px;height:24px;border-radius:50%;border:0;background:#c62828;color:#fff;font-weight:700;padding:0}
.pl-gps{border:1.5px dashed var(--line);border-radius:10px;padding:10px;margin-top:6px}
.pl-big{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center}
.pl-big img{max-width:100%;max-height:100%}
.pl-card .row{margin-top:8px}
</style>`);
    document.body.insertAdjacentHTML('beforeend', '<dialog id="plD" class="mp-dlg vt-dlg"></dialog>');
    D = document.getElementById('plD');
    D.addEventListener('close', () => { form = null; view = 'list'; });
    return D;
  }

  function sorted() {
    const t = q.trim().toLowerCase();
    let L = items.filter(p => (filt == 'all' || p.kind == filt) && (!t || (p.name + ' ' + p.city + ' ' + p.note).toLowerCase().includes(t)));
    L = L.map(p => ({ p, d: here ? km(here, p) : null }));
    if (here) L.sort((a, b) => a.d - b.d);
    return L;
  }

  function itemHtml(o) {
    const p = o.p, k = K(p.kind), u = me(), mine = u && p.user_id == u.id, lk = liked.has(p.id);
    const ph = (p.photos || []).length ? `<div class="pl-ph">${p.photos.map((s, i) => `<img loading="lazy" src="${esc(s)}" data-plbig="${esc(p.id)}:${i}" alt="">`).join('')}</div>` : '';
    const tel = p.phone ? `<a class="g" href="tel:${esc(String(p.phone).replace(/[^\d+]/g, ''))}">📞 ${W('Appeler', 'اتصال', 'Call')}</a>` : '';
    return `<div class="pl-it${p.hidden ? ' pl-hid' : ''}">${ph}<div class="pl-b">
<div class="pl-t">${k[1]} ${esc(p.name)}</div>
<div class="meta">${esc(k[2]())}${p.city ? ' · ' + esc(p.city) : ''}${o.d != null ? ' · 📍 ' + dist(o.d) : ''}${p.author ? ' · ' + W('par', 'بواسطة', 'by') + ' ' + esc(p.author) : ''}</div>
${p.hidden ? `<div style="margin-top:4px"><span class="pl-warn">${W('Masqué : signalé par 3 membres', 'مخفي: أبلغ عنه 3 أعضاء', 'Hidden: reported by 3 members')}</span></div>` : ''}
${p.note ? `<div class="pl-n">${esc(p.note)}</div>` : ''}
<div class="pl-a">
<a class="g" target="_blank" rel="noopener" href="${goUrl(p)}">🧭 ${W('Y aller', 'اذهب', 'Go')}</a>
<a class="g" target="_blank" rel="noopener" href="${mapUrl(p)}">🗺 ${W('Carte', 'الخريطة', 'Map')}</a>${tel}
<button class="g${lk ? ' on' : ''}" data-pllike="${esc(p.id)}">👍 ${p.likes || 0}</button>
${!mine && !p.hidden ? `<button class="g" data-plrep="${esc(p.id)}">🚩 ${W('Signaler', 'إبلاغ', 'Report')}</button>` : ''}
${admin && p.hidden ? `<button class="g" data-plunhide="${esc(p.id)}">👁 ${W('Réafficher', 'إظهار', 'Show again')}</button>` : ''}
${mine || admin ? `<button class="g" data-pldel="${esc(p.id)}">🗑 ${W('Supprimer', 'حذف', 'Delete')}</button>` : ''}
</div></div></div>`;
  }

  function listHtml() {
    const u = me();
    if (!u) return `<div class="card">🔑 ${W('Connecte-toi pour voir et ajouter des adresses.', 'سجّل الدخول لرؤية العناوين وإضافتها.', 'Sign in to see and add places.')}</div>`;
    const chips = `<div class="pl-chips"><button class="g${filt == 'all' ? ' on' : ''}" data-plk="all">${W('Tout', 'الكل', 'All')}</button>${KINDS.map(k => `<button class="g${filt == k[0] ? ' on' : ''}" data-plk="${k[0]}">${k[1]} ${esc(k[2]())}</button>`).join('')}</div>`;
    const L = sorted();
    let body;
    if (err) body = `<div class="card">${esc(err)}</div>`;
    else if (busy && !loaded) body = `<div class="meta" style="margin-top:12px">${W('Chargement…', 'جارٍ التحميل…', 'Loading…')}</div>`;
    else if (!L.length) body = `<div class="meta" style="margin-top:12px">${items.length ? W('Aucune adresse pour ce choix.', 'لا توجد عناوين لهذا الاختيار.', 'No place for this choice.') : W('Aucune adresse pour l’instant. Sois le premier à en ajouter une !', 'لا توجد عناوين بعد. كن أول من يضيف عنوانًا!', 'No places yet. Be the first to add one!')}</div>`;
    else body = L.slice(0, 120).map(itemHtml).join('');
    return `<input id="pl_q" type="search" placeholder="🔎 ${W('Chercher (nom, ville…)', 'ابحث (اسم، مدينة…)', 'Search (name, town…)')}" value="${esc(q)}" style="margin-bottom:8px">${chips}
<div class="meta">${here ? W('Classées de la plus proche à la plus loin.', 'مرتبة من الأقرب إلى الأبعد.', 'Sorted from nearest to farthest.') : W('Active le GPS pour les classer par distance.', 'فعّل GPS لترتيبها حسب المسافة.', 'Turn on GPS to sort by distance.')}</div>${body}`;
  }

  function formHtml() {
    const f = form, g = f.gps;
    const gps = g ? `📍 <b>${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}</b>${g.acc ? ` <span class="meta">(± ${g.acc} m)</span>` : ''}<br><a class="lnk" target="_blank" rel="noopener" href="${mapUrl(g)}">🗺 ${W('Vérifier sur la carte', 'تحقق على الخريطة', 'Check on map')}</a>`
      : (f.locating ? W('Recherche de ta position…', 'جارٍ تحديد موقعك…', 'Finding your position…') : W('Position introuvable : active le GPS puis touche « Ma position ».', 'تعذّر تحديد الموقع: فعّل GPS ثم اضغط «موقعي».', 'Position not found: turn on GPS and tap “My position”.'));
    return `<div class="meta">${W('Ajoute un lieu utile aux motards. Il sera visible tout de suite par tous les membres.', 'أضف مكانًا مفيدًا للسائقين. سيظهر فورًا لكل الأعضاء.', 'Add a place useful to riders. All members will see it right away.')}</div>
<label>${W('Type', 'النوع', 'Type')}</label><div class="pl-chips">${KINDS.map(k => `<button class="g${f.kind == k[0] ? ' on' : ''}" data-plfk="${k[0]}">${k[1]} ${esc(k[2]())}</button>`).join('')}</div>
<label for="pl_n">${W('Nom du lieu *', 'اسم المكان *', 'Place name *')}</label><input id="pl_n" maxlength="80" value="${esc(f.name)}" placeholder="${W('ex. Café du col de Tikjda', 'مثال: مقهى ممر تيكجدة', 'e.g. Tikjda pass café')}">
<label for="pl_c">${W('Ville / région', 'المدينة / المنطقة', 'Town / area')}</label><input id="pl_c" maxlength="60" value="${esc(f.city)}">
<label for="pl_t">${W('Ton avis, conseils', 'رأيك ونصائحك', 'Your review, tips')}</label><textarea id="pl_t" rows="3" maxlength="600" placeholder="${W('Accueil, prix, parking moto, horaires…', 'الاستقبال، الأسعار، موقف الدراجات، المواعيد…', 'Welcome, prices, bike parking, hours…')}">${esc(f.note)}</textarea>
<label for="pl_p">${W('Téléphone (facultatif)', 'الهاتف (اختياري)', 'Phone (optional)')}</label><input id="pl_p" type="tel" maxlength="25" value="${esc(f.phone)}">
<label>${W('Position GPS *', 'موقع GPS *', 'GPS position *')}</label><div class="pl-gps">${gps}<div style="margin-top:8px"><button class="g" data-plgps="1">📍 ${W('Ma position', 'موقعي', 'My position')}</button></div>
<div class="meta" style="margin-top:6px">${W('Ajoute le lieu quand tu es sur place : c’est ta position qui est enregistrée.', 'أضف المكان وأنت فيه: يُسجَّل موقعك الحالي.', 'Add the place while you are there: your current position is saved.')}</div></div>
<label>${W('Photos du lieu', 'صور المكان', 'Photos of the place')} (${f.photos.length}/${MAXP})</label>
<div class="pl-picks">${f.photos.map((s, i) => `<div><img src="${s}" alt=""><button data-plrm="${i}" aria-label="✕">✕</button></div>`).join('')}</div>
${f.photos.length < MAXP ? `<div class="row" style="justify-content:flex-start;gap:8px"><label class="g" style="margin:0;font-weight:500;cursor:pointer">🖼 ${W('Galerie', 'المعرض', 'Gallery')}<input id="pl_gal" type="file" accept="image/*" multiple hidden></label><label class="g" style="margin:0;font-weight:500;cursor:pointer">📷 ${W('Photo', 'صورة', 'Camera')}<input id="pl_cam" type="file" accept="image/*" capture="environment" hidden></label></div>` : ''}
${f.msg ? `<div class="card" style="margin-top:10px">${esc(f.msg)}</div>` : ''}`;
  }

  function paint() {
    if (!D || !D.open) return;
    const add = view == 'add';
    const keepQ = document.activeElement && document.activeElement.id == 'pl_q';
    if (add) readForm();
    D.innerHTML = `<div class="vt-h"><h2>📍 ${add ? W('Ajouter une adresse', 'إضافة عنوان', 'Add a place') : W('Bonnes adresses', 'عناوين مفيدة', 'Good places')}</h2>
<div class="meta">${add ? '' : W('Hébergements, restos, stations, mécanos, points de vue… partagés par les motards.', 'مبيت، مطاعم، محطات، ميكانيكيون، مناظر… يشاركها السائقون.', 'Lodging, food, fuel, mechanics, viewpoints… shared by riders.')}</div></div>
<div class="vt-b">${add ? formHtml() : listHtml()}</div>
<div class="vt-f">${add
      ? `<button class="g" data-plback="1">${W('Annuler', 'إلغاء', 'Cancel')}</button><button class="p" data-plsave="1" ${form.saving ? 'disabled' : ''}>${form.saving ? W('Envoi…', 'جارٍ الإرسال…', 'Sending…') : '✓ ' + W('Publier', 'نشر', 'Publish')}</button>`
      : `<button class="g" data-plclose="1">${W('Fermer', 'إغلاق', 'Close')}</button>${me() ? `<button class="p" data-pladd="1">＋ ${W('Ajouter', 'إضافة', 'Add')}</button>` : ''}`}</div>`;
    if (keepQ) { const i = D.querySelector('#pl_q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }

  function readForm() {
    if (!form || !D) return;
    const v = id => { const e = D.querySelector('#' + id); return e ? e.value : null; };
    const n = v('pl_n'); if (n == null) return;
    form.name = n; form.city = v('pl_c'); form.note = v('pl_t'); form.phone = v('pl_p');
  }

  async function open(kind) {
    ensure();
    if (kind && KINDS.some(k => k[0] == kind)) filt = kind;
    view = 'list';
    if (!D.open) D.showModal();
    paint();
    if (!here || Date.now() - hereAt > 120000) locate(false).then(p => { if (p) { here = p; hereAt = Date.now(); paint(); } });
    if (Date.now() - loaded > 30000) await load(); else paint();
  }

  function newForm() {
    form = { kind: filt != 'all' ? filt : 'food', name: '', city: '', note: '', phone: '', photos: [], gps: null, locating: false, msg: '', saving: false };
    view = 'add'; paint(); const vb = D.querySelector('.vt-b'); if (vb) vb.scrollTop = 0; gps();
  }
  async function gps() {
    form.locating = true; form.gps = null; paint();
    const p = await locate(true);
    if (!form) return;
    form.locating = false; form.gps = p; if (p) { here = p; hereAt = Date.now(); }
    paint();
  }

  async function save() {
    readForm();
    const f = form, u = me(), c = sbc();
    if (!u || !c) return;
    if (btrim(f.name).length < 2) { f.msg = W('Indique le nom du lieu.', 'اكتب اسم المكان.', 'Enter the place name.'); paint(); return; }
    if (!f.gps) { f.msg = W('Il manque la position GPS : touche « Ma position ».', 'ينقص موقع GPS: اضغط «موقعي».', 'GPS position missing: tap “My position”.'); paint(); return; }
    f.saving = true; f.msg = ''; paint();
    const urls = [];
    try {
      for (const d of f.photos) urls.push(await upload(d));
      const r = await c.from('places').insert({
        kind: f.kind, name: btrim(f.name).slice(0, 80), city: btrim(f.city).slice(0, 60), note: btrim(f.note).slice(0, 600),
        phone: btrim(f.phone).slice(0, 25), lat: +f.gps.lat.toFixed(6), lng: +f.gps.lng.toFixed(6), photos: urls
      }).select('id,user_id,author,kind,name,city,note,phone,lat,lng,photos,likes,reports,hidden,created_at').single();
      if (r.error) throw r.error;
      items.unshift(r.data); form = null; view = 'list'; filt = 'all'; paint();
    } catch (e) {
      rmPhotos(urls);
      f.saving = false; f.msg = errTxt(e); paint();
    }
  }
  const btrim = s => String(s || '').trim();

  async function addFiles(files) {
    for (const file of Array.from(files || [])) {
      if (form.photos.length >= MAXP) break;
      try { form.photos.push(await shrink(file)); } catch (e) { console.error('places photo', e); }
    }
    paint();
  }

  /* ---------- Événements ---------- */
  document.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-plopen],[data-plclose],[data-pladd],[data-plback],[data-plsave],[data-plk],[data-plfk],[data-plgps],[data-plrm],[data-pllike],[data-plrep],[data-pldel],[data-plunhide],[data-plbig]');
    if (!b) { if (big && ev.target.closest('.pl-big')) { big.remove(); big = null; } return; }
    const d = b.dataset, c = sbc();
    if (d.plopen !== undefined) { ev.preventDefault(); ev.stopImmediatePropagation(); open(d.plopen).then(() => { if (d.plnew && me() && D && D.open) newForm(); }); return; }
    if (!D || !D.contains(b)) return;
    ev.preventDefault();
    if (d.plclose !== undefined) { D.close(); return; }
    if (d.pladd !== undefined) { newForm(); return; }
    if (d.plback !== undefined) { form = null; view = 'list'; paint(); return; }
    if (d.plsave !== undefined) { if (!form.saving) save(); return; }
    if (d.plk !== undefined) { filt = d.plk; paint(); return; }
    if (d.plfk !== undefined) { readForm(); form.kind = d.plfk; paint(); return; }
    if (d.plgps !== undefined) { readForm(); gps(); return; }
    if (d.plrm !== undefined) { readForm(); form.photos.splice(+d.plrm, 1); paint(); return; }
    if (d.plbig !== undefined) {
      const [id, i] = d.plbig.split(':'), p = items.find(x => x.id == id); if (!p) return;
      big = document.createElement('div'); big.className = 'pl-big'; big.innerHTML = `<img src="${esc(p.photos[+i])}" alt="">`;
      D.appendChild(big); return;
    }
    const p = items.find(x => x.id == (d.pllike || d.plrep || d.pldel || d.plunhide));
    if (!p || !c) return;
    b.disabled = true;
    try {
      if (d.pllike !== undefined) {
        const r = await c.rpc('mr_place_like', { p_place: p.id }); if (r.error) throw r.error;
        p.likes = r.data.likes; r.data.liked ? liked.add(p.id) : liked.delete(p.id);
      } else if (d.plrep !== undefined) {
        const why = prompt(W('Pourquoi signaler cette adresse ? (fermée, fausse, pas pour les motards…)', 'لماذا تبلغ عن هذا العنوان؟ (مغلق، خاطئ، غير مناسب…)', 'Why report this place? (closed, fake, not for riders…)'));
        if (why === null) { b.disabled = false; return; }
        const r = await c.rpc('mr_place_report', { p_place: p.id, p_reason: why }); if (r.error) throw r.error;
        p.reports = r.data.reports; if (r.data.hidden) { p.hidden = true; if (!admin) items = items.filter(x => x !== p); }
        alert(W('Merci, c’est signalé. Au 3ᵉ signalement, l’adresse est masquée.', 'شكرًا، تم الإبلاغ. عند البلاغ الثالث يُخفى العنوان.', 'Thanks, reported. After 3 reports the place is hidden.'));
      } else if (d.plunhide !== undefined) {
        const r = await c.rpc('mr_place_unhide', { p_place: p.id }); if (r.error) throw r.error;
        p.hidden = false; p.reports = 0;
      } else if (d.pldel !== undefined) {
        if (!confirm(W('Supprimer « ' + p.name + ' » pour tout le monde ?', 'حذف «' + p.name + '» عند الجميع؟', 'Delete “' + p.name + '” for everyone?'))) { b.disabled = false; return; }
        const r = await c.from('places').delete().eq('id', p.id); if (r.error) throw r.error;
        rmPhotos(p.photos); items = items.filter(x => x !== p);
      }
    } catch (e) { alert(errTxt(e)); }
    paint();
  }, true);

  document.addEventListener('input', ev => { if (ev.target.id == 'pl_q') { q = ev.target.value; paint(); } });
  document.addEventListener('change', ev => {
    if ((ev.target.id == 'pl_gal' || ev.target.id == 'pl_cam') && form) { readForm(); addFiles(ev.target.files); }
  });

  /* ---------- Carte d'entrée dans l'onglet Route ---------- */
  function card() {
    return `<div class="card pl-card"><div class="row" style="margin-top:0"><b style="font-size:17px">📍 ${W('Bonnes adresses sur la route', 'عناوين مفيدة على الطريق', 'Good places on the road')}</b></div>
<div class="meta">${W('Hébergements, restos, stations, mécanos, points de vue… ajoutés par les motards, avec GPS et photos.', 'مبيت، مطاعم، محطات، ميكانيكيون، مناظر… يضيفها السائقون مع GPS وصور.', 'Lodging, food, fuel, mechanics, viewpoints… added by riders, with GPS and photos.')}</div>
<div class="row" style="justify-content:flex-start;gap:8px;flex-wrap:wrap"><button class="p" data-plopen="">🔎 ${W('Voir les adresses', 'عرض العناوين', 'Browse places')}</button><button class="g" data-plopen="" data-plnew="1">＋ ${W('Ajouter', 'إضافة', 'Add')}</button></div></div>`;
  }
  if (typeof routeView == 'function') {
    const _rv = routeView;
    routeView = function (t) { let h = _rv(t); try { h = card() + h; } catch (e) {} return h; };
  }
  window.mrPlacesOpen = open;
  try { if (tab == 4) render(); } catch (e) {}
})();
