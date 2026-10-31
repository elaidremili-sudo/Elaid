/* MotoRoute – Inclinaison colorée dans l'onglet Conduite (test-71, 31/10/2026, demande d'Elaid)
   Avant : un petit tracé du dernier trajet, caché dans « MotoRoute Plus ».
   Maintenant, dans Conduite :
   - choix du trajet (les 15 derniers trajets avec tracé) ;
   - tracé coloré en 5 niveaux d'inclinaison, virages numérotés ;
   - bilan : nombre de virages, max à gauche / à droite, part du trajet dans chaque niveau ;
   - liste des virages les plus penchés (côté, angle, vitesse, moment du trajet) ;
   - « ⤢ Agrandir » : plein écran, zoom à deux doigts (ou boutons + / −), déplacement au doigt,
     toucher le tracé = détail du point ; toucher un virage de la liste = zoom sur ce virage ;
     profil d'inclinaison le long du trajet en bas, qu'on peut toucher aussi.
   Format d'un point de trajet (onglet Conduite) : [lat, lng, inclinaison max du tronçon, côté (-1 gauche, 1 droite, 0), km/h, secondes depuis le départ, altitude]. */
(function () {
  'use strict';
  const L3 = (fr, ar, en) => (typeof lang !== 'undefined' && lang === 'ar') ? ar : (typeof lang !== 'undefined' && lang === 'en') ? en : fr;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BANDS = [[10, '#7c8a99'], [20, '#22a35a'], [30, '#e8b404'], [40, '#ef7d1a'], [999, '#e5312a']];
  const col = a => { for (const b of BANDS) if (a < b[0]) return b[1]; return BANDS[4][1]; };
  const TURN_MIN = 15;
  let sel = null;           // id du trajet choisi
  let big = null;           // état du plein écran

  const rides = () => { try { return (S.rides || []).filter(r => r && r.tk && r.tk.length >= 2).slice(0, 15); } catch (e) { return []; } };
  const cur = () => { const R = rides(); return R.find(r => r.id === sel) || R[0] || null; };
  const fmtT = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? h + ' ' + L3('h', 'سا', 'h') + ' ' + String(m).padStart(2, '0') : m + ' ' + L3('min', 'د', 'min') + ' ' + String(s % 60).padStart(2, '0'); };
  const side = v => v < 0 ? L3('à gauche', 'يسار', 'left') : v > 0 ? L3('à droite', 'يمين', 'right') : '';
  const sideArrow = v => v < 0 ? '↶' : v > 0 ? '↷' : '';

  /* distance en mètres entre deux points */
  function hv(a, b) { const r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r, x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 12742e3 * Math.asin(Math.sqrt(x)); }

  /* analyse d'un trajet : distances cumulées, virages, part de chaque niveau */
  function analyse(tk) {
    const d = [0]; for (let i = 1; i < tk.length; i++) d.push(d[i - 1] + hv(tk[i - 1], tk[i]));
    const band = BANDS.map(() => 0);
    for (let i = 1; i < tk.length; i++) { const a = tk[i][2] || 0, seg = d[i] - d[i - 1]; band[BANDS.findIndex(b => a < b[0])] += seg; }
    const turns = []; let t = null, gap = 0;
    for (let i = 0; i < tk.length; i++) {
      const a = tk[i][2] || 0, s = tk[i][3] || 0;
      if (a >= TURN_MIN && s) {
        if (t && s === t.side && gap <= 1) { t.end = i; if (a > t.lean) { t.lean = a; t.apex = i; } gap = 0; }
        else { if (t) turns.push(t); t = { side: s, start: i, end: i, apex: i, lean: a }; gap = 0; }
      } else if (t) { gap++; if (gap > 1) { turns.push(t); t = null; gap = 0; } }
    }
    if (t) turns.push(t);
    turns.forEach((x, k) => { x.n = k + 1; const p = tk[x.apex]; x.spd = p[4] || 0; x.sec = p[5] || 0; x.km = d[x.apex] / 1000; });
    const total = d[d.length - 1] || 1;
    let mL = 0, mR = 0; turns.forEach(x => { if (x.side < 0) mL = Math.max(mL, x.lean); else mR = Math.max(mR, x.lean); });
    return { d, total, band: band.map(v => v / total), turns, mL, mR };
  }

  /* projection en mètres (équirectangulaire) */
  function geo(tk) { const c = Math.cos(tk[0][0] * Math.PI / 180), R = 6371e3 * Math.PI / 180; return tk.map(p => [p[1] * c * R, -p[0] * R]); }
  function fit(P, W, H, pad) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; P.forEach(p => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    const k = Math.min((W - 2 * pad) / ((x1 - x0) || 1), (H - 2 * pad) / ((y1 - y0) || 1));
    return { k, x: (W - (x1 - x0) * k) / 2 - x0 * k, y: (H - (y1 - y0) * k) / 2 - y0 * k };
  }

  /* dessin du tracé : v = vue {k, x, y} (échelle et décalage en pixels) */
  function drawTrack(cv, tk, P, A, v, opt) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const Q = P.map(p => [p[0] * v.k + v.x, p[1] * v.k + v.y]);
    const lw = Math.max(4, Math.min(10, 3 + Math.log2(Math.max(1, v.k / (opt.k0 || v.k))) * 1.6));
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = lw + 5; g.beginPath(); Q.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.stroke();
    g.lineWidth = lw;
    for (let i = 1; i < Q.length; i++) { g.strokeStyle = col(tk[i][2] || 0); g.beginPath(); g.moveTo(Q[i - 1][0], Q[i - 1][1]); g.lineTo(Q[i][0], Q[i][1]); g.stroke(); }
    const dot = (q, f, r) => { g.fillStyle = f; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(q[0], q[1], r, 0, 7); g.fill(); g.stroke(); };
    dot(Q[0], '#22a35a', 6); dot(Q[Q.length - 1], '#111', 6);
    /* numéros des virages (les plus penchés d'abord si la place manque) */
    const shown = [], minGap = 26;
    A.turns.slice().sort((a, b) => b.lean - a.lean).forEach(t => {
      const q = Q[t.apex]; if (q[0] < -20 || q[1] < -20 || q[0] > W + 20 || q[1] > H + 20) return;
      if (shown.some(s => Math.hypot(s[0] - q[0], s[1] - q[1]) < minGap)) return; shown.push(q);
      const r = opt.small ? 8 : 11; g.fillStyle = 'rgba(15,18,22,.85)'; g.strokeStyle = col(t.lean); g.lineWidth = 2;
      g.beginPath(); g.arc(q[0], q[1] - r - 6, r, 0, 7); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = `700 ${opt.small ? 9 : 11}px system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t.n, q[0], q[1] - r - 6);
    });
    if (opt.hi != null && Q[opt.hi]) { const q = Q[opt.hi]; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(q[0], q[1], 11, 0, 7); g.stroke(); dot(q, col(tk[opt.hi][2] || 0), 6); }
    /* échelle */
    if (!opt.small) { const m = [50, 100, 200, 500, 1000, 2000, 5000, 10000].find(x => x * v.k > 70) || 10000, px = m * v.k;
      g.fillStyle = 'rgba(255,255,255,.85)'; const sx0 = opt.rtl ? W - 70 - px : 14; g.fillRect(sx0, 30, px, 3); g.font = '600 11px system-ui,sans-serif'; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(m >= 1000 ? m / 1000 + ' km' : m + ' m', sx0, 26); }
  }

  /* profil d'inclinaison le long du trajet */
  function drawProfile(cv, tk, A, hi) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const mid = H / 2, mx = Math.max(45, A.mL, A.mR), sx = x => x / A.total * W, sy = a => a / mx * (mid - 4);
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, mid); g.lineTo(W, mid); g.stroke();
    [20, 40].forEach(a => { if (a > mx) return; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(0, mid - sy(a)); g.lineTo(W, mid - sy(a)); g.moveTo(0, mid + sy(a)); g.lineTo(W, mid + sy(a)); g.stroke(); g.setLineDash([]); });
    for (let i = 1; i < tk.length; i++) { const a = tk[i][2] || 0, s = tk[i][3] || 0; if (!a) continue; const x0 = sx(A.d[i - 1]), x1 = Math.max(x0 + 1, sx(A.d[i])), h = sy(a);
      g.fillStyle = col(a); if (s < 0) g.fillRect(x0, mid - h, x1 - x0, h); else g.fillRect(x0, mid, x1 - x0, h); }
    g.fillStyle = 'rgba(255,255,255,.7)'; g.font = '600 10px system-ui,sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
    g.fillText('↶ ' + L3('gauche', 'يسار', 'left'), 4, 2); g.textBaseline = 'bottom'; g.fillText('↷ ' + L3('droite', 'يمين', 'right'), 4, H - 2);
    if (hi != null) { const x = sx(A.d[hi]); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  }

  const legend = () => `<div class="lc-leg">${BANDS.map((b, i) => `<span><i style="background:${b[1]}"></i>${i === 0 ? '&lt;10°' : i === 4 ? '40°+' : BANDS[i - 1][0] + '–' + b[0] + '°'}</span>`).join('')}</div>`;

  function turnRow(t) {
    return `<button type="button" class="lc-turn" data-lcturn="${t.n}"><b class="lc-n" style="border-color:${col(t.lean)}">${t.n}</b>
      <span><b style="color:${col(t.lean)}">${sideArrow(t.side)} ${Math.round(t.lean)}°</b> ${side(t.side)} · ${Math.round(t.spd)} km/h<br><small>${L3('au km', 'عند الكم', 'at km')} ${t.km.toFixed(1)} · ${fmtT(t.sec)}</small></span><span class="lc-z">⤢</span></button>`;
  }

  /* ===== carte dans l'onglet Conduite ===== */
  window.mrLeanCard = function () {
    const R = rides(), r = cur();
    const h3 = `<h3>🎨 ${L3('Inclinaison colorée', 'الميل الملوّن', 'Lean map')}</h3>`;
    if (!r) {
      const any = (S.rides || []).length;
      return `<div class="card" id="lc_card">${h3}<div class="meta">${any ? L3('Ce trajet a été enregistré sans tracé. Ton prochain trajet sera dessiné ici, en couleurs selon ton inclinaison, virage par virage.', 'سُجّلت هذه الرحلة بدون مسار. رحلتك القادمة سترسم هنا ملوّنة حسب الميلان، منعطفًا بمنعطف.', 'This trip was saved without a track. Your next trip will be drawn here, coloured by lean, turn by turn.') : L3('Démarre un trajet ci-dessus : à l’arrivée, il sera dessiné ici en couleurs selon ton inclinaison, virage par virage.', 'ابدأ رحلة أعلاه: عند الوصول سترسم هنا ملوّنة حسب الميلان، منعطفًا بمنعطف.', 'Start a trip above: when you arrive, it will be drawn here coloured by lean, turn by turn.')}</div></div>`;
    }
    const A = analyse(r.tk), top = A.turns.slice().sort((a, b) => b.lean - a.lean).slice(0, 5);
    const opts = R.map(x => `<option value="${x.id}" ${x.id === r.id ? 'selected' : ''}>${esc(x.d)} · ${x.km} km · ${Math.max(x.lL || 0, x.lR || 0)}°</option>`).join('');
    const bars = `<div class="lc-bar">${A.band.map((f, i) => f > 0.004 ? `<i style="width:${(f * 100).toFixed(1)}%;background:${BANDS[i][1]}" title="${Math.round(f * 100)}%"></i>` : '').join('')}</div>`;
    return `<div class="card" id="lc_card">${h3}
      ${R.length > 1 ? `<select id="lc_sel" aria-label="${L3('Choisir le trajet', 'اختر الرحلة', 'Choose the trip')}">${opts}</select>` : `<div class="meta">${esc(r.d)} · ${r.km} km</div>`}
      <div class="lc-wrap"><canvas id="lc_cv" class="lc-cv" aria-label="${L3('Tracé du trajet coloré selon l’inclinaison', 'مسار الرحلة ملوّن حسب الميلان', 'Trip track coloured by lean')}"></canvas>
        <button type="button" class="lc-big" data-lcbig="1">⤢ ${L3('Agrandir', 'تكبير', 'Enlarge')}</button></div>
      ${legend()}
      <div class="lc-stats"><div><b>${A.turns.length}</b><small>${L3('virages', 'منعطفات', 'turns')} ≥${TURN_MIN}°</small></div><div><b>↶ ${Math.round(A.mL || r.lL || 0)}°</b><small>${L3('max gauche', 'أقصى يسار', 'max left')}</small></div><div><b>↷ ${Math.round(A.mR || r.lR || 0)}°</b><small>${L3('max droite', 'أقصى يمين', 'max right')}</small></div></div>
      <div class="meta">${L3('Part du trajet par niveau d’inclinaison', 'نسبة الرحلة حسب الميلان', 'Share of the trip by lean level')}</div>${bars}
      ${calHtml(r)}
      ${top.length ? `<div class="meta" style="margin-top:10px"><b>${L3('Tes virages les plus penchés', 'أكثر منعطفاتك ميلًا', 'Your most leaned turns')}</b> · ${L3('touche pour zoomer', 'المس للتكبير', 'tap to zoom')}</div>${top.map(turnRow).join('')}` : `<div class="meta">${L3('Pas de virage à plus de 15° sur ce trajet.', 'لا يوجد منعطف بأكثر من 15° في هذه الرحلة.', 'No turn over 15° on this trip.')}</div>`}
    </div>`;
  };

  /* ===== réglage avec le tableau de bord de la moto (test-71) =====
     Les motos à centrale inertielle (ex. Kawasaki Z H2) affichent l'angle maximum gauche / droite du trajet : c'est la référence.
     - le trajet choisi est corrigé (max gauche / droite et couleurs du tracé) ;
     - si le trajet a été mesuré avec le nouveau calcul (test-71, r.lv >= 2), le coefficient est gardé (S.leanK)
       et appliqué ensuite à tous les trajets ; les trajets plus anciens (ancien calcul, trop fort) sont seulement corrigés un par un. */
  let calOpen = false;
  function calHtml(r) {
    const k = +S.leanK || 1, act = Math.abs(k - 1) > .005;
    const head = `<div class="lc-cal"><button type="button" class="g" data-lccal="1">📏 ${L3('Ma moto affichait un autre angle ?', 'دراجتي أظهرت زاوية أخرى؟', 'My bike showed a different angle?')}</button>${act ? `<div class="meta">${L3('Réglage actif', 'ضبط مفعّل', 'Active setting')} : × ${k.toFixed(2)} · <a href="#" data-lccal0="1">${L3('Annuler le réglage', 'إلغاء الضبط', 'Reset')}</a></div>` : ''}`;
    if (!calOpen) return head + '</div>';
    const old = !(r.lv >= 2);
    return head + `<div class="meta" style="margin-top:6px">${L3('Si ta moto a une centrale inertielle (inclinaison affichée sur le tableau de bord), entre les angles maximum qu’elle a affichés pour ce trajet.', 'إذا كانت دراجتك تعرض الميلان على لوحة القيادة، أدخل أقصى الزوايا التي أظهرتها لهذه الرحلة.', 'If your bike shows lean angle on its dashboard, enter the maximum angles it showed for this trip.')}</div>
      <div class="row" style="gap:8px;justify-content:flex-start;flex-wrap:wrap"><label>↶ ${L3('Gauche', 'يسار', 'Left')} <input id="lc_cl" type="number" inputmode="decimal" min="5" max="65" style="width:80px" placeholder="${Math.round(r.lL || 0)}"></label>
      <label>↷ ${L3('Droite', 'يمين', 'Right')} <input id="lc_cr" type="number" inputmode="decimal" min="5" max="65" style="width:80px" placeholder="${Math.round(r.lR || 0)}"></label>
      <button type="button" class="p" data-lccalok="1">${L3('Appliquer', 'تطبيق', 'Apply')}</button></div>
      <div class="meta">${old ? L3('Ce trajet a été mesuré avec l’ancien calcul (plus fort) : il sera corrigé, mais le réglage ne sera pas gardé pour les prochains. Fais-le sur un trajet enregistré avec cette version.', 'سُجّلت هذه الرحلة بالحساب القديم: ستُصحّح هي فقط.', 'This trip used the old calculation: only this trip will be corrected.') : L3('Le réglage sera gardé et appliqué à tes prochains trajets. Une seule valeur suffit (gauche ou droite).', 'سيُحفظ الضبط ويطبّق على رحلاتك القادمة. تكفي قيمة واحدة.', 'The setting will be kept for your next trips. One value is enough.')}</div></div>`;
  }
  function calApply() {
    const r = cur(); if (!r) return;
    const n = id => { const v = parseFloat(String((document.getElementById(id) || {}).value || '').replace(',', '.')); return v >= 5 && v <= 65 ? v : null; };
    const dl = n('lc_cl'), dr = n('lc_cr'), al = r.lL || 0, ar = r.lR || 0;
    const ks = []; if (dl && al >= 8) ks.push(dl / al); if (dr && ar >= 8) ks.push(dr / ar);
    if (!ks.length) { alert(L3('Entre au moins un angle (gauche ou droite), pour un trajet avec des virages d’au moins 8°.', 'أدخل زاوية واحدة على الأقل.', 'Enter at least one angle.')); return; }
    const k = Math.max(.6, Math.min(1.3, ks.reduce((a, b) => a + b, 0) / ks.length));
    r.lL = Math.round(al * k); r.lR = Math.round(ar * k); r.tk = r.tk.map(p => { const q = p.slice(); q[2] = Math.round((q[2] || 0) * k); return q; }); r.cal = (r.cal || 1) * k;
    if (r.lv >= 2) S.leanK = Math.max(.6, Math.min(1.3, (+S.leanK || 1) * k));
    calOpen = false; try { save(); } catch (e) {}
    const c = document.getElementById('lc_card'); if (c) { c.outerHTML = window.mrLeanCard(); setTimeout(paintCard, 0); }
    alert(L3(`✅ Trajet corrigé (× ${k.toFixed(2)}).`, `✅ صُحّحت الرحلة (× ${k.toFixed(2)}).`, `✅ Trip corrected (× ${k.toFixed(2)}).`) + (r.lv >= 2 ? '\n' + L3('Le réglage s’appliquera aussi à tes prochains trajets.', 'سيطبّق الضبط على رحلاتك القادمة.', 'It will apply to your next trips too.') : ''));
  }

  function paintCard() {
    const cv = document.getElementById('lc_cv'), r = cur(); if (!cv || !r || !cv.clientWidth) return;
    const P = geo(r.tk), v = fit(P, cv.clientWidth, cv.clientHeight, 22), A = analyse(r.tk);
    drawTrack(cv, r.tk, P, A, v, { small: true });
  }

  /* ===== plein écran avec zoom ===== */
  function openBig(turnN) {
    const r = cur(); if (!r) return;
    const A = analyse(r.tk), P = geo(r.tk);
    let dl = document.getElementById('lc_dl');
    if (!dl) { dl = document.createElement('dialog'); dl.id = 'lc_dl'; dl.className = 'lc-dl'; document.body.appendChild(dl); }
    dl.setAttribute('dir', typeof lang !== 'undefined' && lang === 'ar' ? 'rtl' : 'ltr');
    dl.innerHTML = `<div class="lc-hd"><b>🎨 ${esc(r.d)} · ${r.km} km</b><button type="button" class="g" data-lcx="1">${L3('Fermer', 'إغلاق', 'Close')}</button></div>
      <div class="lc-map"><canvas id="lc_bcv"></canvas>
        <div class="lc-zb"><button type="button" data-lcz="1.6" aria-label="+">＋</button><button type="button" data-lcz="0.625" aria-label="−">－</button><button type="button" data-lcz="0" aria-label="${L3('Tout voir', 'عرض الكل', 'Show all')}">⌂</button></div>
        <div class="lc-info" id="lc_info">${L3('Pince avec deux doigts pour zoomer, glisse pour te déplacer, touche le tracé pour voir le détail.', 'باعد بإصبعين للتكبير، اسحب للتحرك، والمس المسار لرؤية التفاصيل.', 'Pinch to zoom, drag to move, tap the track for details.')}</div></div>
      <canvas id="lc_pcv" class="lc-pcv"></canvas>${legend()}
      <div class="lc-list">${A.turns.length ? A.turns.map(turnRow).join('') : `<div class="meta">${L3('Pas de virage à plus de 15°.', 'لا يوجد منعطف بأكثر من 15°.', 'No turn over 15°.')}</div>`}</div>`;
    if (!dl.open) dl.showModal();
    const cv = dl.querySelector('#lc_bcv'), pc = dl.querySelector('#lc_pcv');
    const v0 = fit(P, cv.clientWidth, cv.clientHeight, 30);
    big = { r, A, P, cv, pc, v: { ...v0 }, v0, hi: null };
    if (turnN) focusTurn(turnN); else paintBig();
    bindGestures(cv); bindProfile(pc);
  }
  function paintBig() { if (!big) return; drawTrack(big.cv, big.r.tk, big.P, big.A, big.v, { k0: big.v0.k, hi: big.hi, rtl: typeof lang !== 'undefined' && lang === 'ar' }); drawProfile(big.pc, big.r.tk, big.A, big.hi); }
  function info(i) {
    const p = big.r.tk[i], e = document.getElementById('lc_info'); if (!p || !e) return;
    const t = big.A.turns.find(x => i >= x.start && i <= x.end);
    e.innerHTML = `<b style="color:${col(p[2] || 0)}">${sideArrow(p[3])} ${Math.round(p[2] || 0)}°</b> ${side(p[3]) || L3('tout droit', 'مستقيم', 'straight')} · <b>${Math.round(p[4] || 0)} km/h</b> · ${L3('km', 'كم', 'km')} ${(big.A.d[i] / 1000).toFixed(2)} · ${fmtT(p[5])}${p[6] != null ? ' · ⛰ ' + p[6] + ' m' : ''}${t ? ` · ${L3('virage n°', 'منعطف رقم', 'turn no.')} ${t.n} (max ${Math.round(t.lean)}°)` : ''}`;
  }
  function focusTurn(n) {
    const t = big.A.turns.find(x => x.n === +n); if (!t) return;
    /* cadre le virage avec un peu de marge autour */
    const a = Math.max(0, t.start - 3), b = Math.min(big.P.length - 1, t.end + 3), seg = big.P.slice(a, b + 1);
    const W = big.cv.clientWidth, H = big.cv.clientHeight, f = fit(seg, W, H, 60);
    const k = Math.min(f.k, big.v0.k * 60, 4 /* px par mètre */);
    const c = seg.reduce((s, p) => [s[0] + p[0] / seg.length, s[1] + p[1] / seg.length], [0, 0]);
    big.v = { k, x: W / 2 - c[0] * k, y: H / 2 - c[1] * k }; big.hi = t.apex; info(t.apex); paintBig();
  }
  function zoomAt(f, cx, cy) {
    const v = big.v, k = Math.max(big.v0.k * 0.8, Math.min(big.v0.k * 400, v.k * f)), r = k / v.k;
    big.v = { k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r }; paintBig();
  }
  function nearest(px, py) {
    let best = -1, bd = 1e9; big.P.forEach((p, i) => { const d = Math.hypot(p[0] * big.v.k + big.v.x - px, p[1] * big.v.k + big.v.y - py); if (d < bd) { bd = d; best = i; } });
    return bd < 28 ? best : -1;
  }
  function bindGestures(cv) {
    const pts = new Map(); let last = null, moved = false;
    const pos = e => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, pos(e)); moved = false; last = null; });
    cv.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return; const p = pos(e), old = pts.get(e.pointerId); pts.set(e.pointerId, p);
      if (pts.size === 1) { const dx = p[0] - old[0], dy = p[1] - old[1]; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true; big.v.x += dx; big.v.y += dy; paintBig(); }
      else if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); moved = true;
        if (last) zoomAt(d / last, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); last = d; }
    });
    const up = e => { const p = pts.get(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) last = null;
      if (p && !moved && pts.size === 0) { const i = nearest(p[0], p[1]); if (i >= 0) { big.hi = i; info(i); paintBig(); } } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); const p = pos(e); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, p[0], p[1]); }, { passive: false });
    cv.addEventListener('dblclick', e => { const p = pos(e); zoomAt(2, p[0], p[1]); });
  }
  function bindProfile(pc) {
    const pick = e => { const b = pc.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * big.A.total; let i = 0; while (i < big.A.d.length - 1 && big.A.d[i] < x) i++; big.hi = i;
      const W = big.cv.clientWidth, H = big.cv.clientHeight, p = big.P[i]; big.v.x = W / 2 - p[0] * big.v.k; big.v.y = H / 2 - p[1] * big.v.k; info(i); paintBig(); };
    pc.style.touchAction = 'none';
    pc.addEventListener('pointerdown', e => { pc.setPointerCapture(e.pointerId); pick(e); });
    pc.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') pick(e); });
  }

  /* ===== événements ===== */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-lcbig],[data-lcturn],[data-lcz],[data-lcx],[data-lccal],[data-lccal0],[data-lccalok]'); if (!b) return;
    if (b.dataset.lccal !== undefined || b.dataset.lccal0 !== undefined || b.dataset.lccalok !== undefined) {
      e.preventDefault();
      if (b.dataset.lccalok !== undefined) return calApply();
      if (b.dataset.lccal0 !== undefined) { if (!confirm(L3('Annuler le réglage ? Les prochains trajets seront mesurés sans correction.', 'إلغاء الضبط؟', 'Reset the setting?'))) return; S.leanK = 1; try { save(); } catch (x) {} }
      else calOpen = !calOpen;
      const c = document.getElementById('lc_card'); if (c) { c.outerHTML = window.mrLeanCard(); setTimeout(paintCard, 0); } return;
    }
    const D = b.dataset;
    if (D.lcx !== undefined) { const dl = document.getElementById('lc_dl'); if (dl) dl.close(); big = null; return; }
    if (D.lcz !== undefined) { if (!big) return; const f = +D.lcz; if (!f) { big.v = { ...big.v0 }; big.hi = null; paintBig(); } else zoomAt(f, big.cv.clientWidth / 2, big.cv.clientHeight / 2); return; }
    if (D.lcturn !== undefined) { if (big && document.getElementById('lc_dl') && document.getElementById('lc_dl').open) focusTurn(D.lcturn); else openBig(+D.lcturn); return; }
    if (D.lcbig !== undefined) openBig();
  });
  document.addEventListener('change', e => { if (e.target && e.target.id === 'lc_sel') { sel = +e.target.value; const c = document.getElementById('lc_card'); if (c) { c.outerHTML = window.mrLeanCard(); setTimeout(paintCard, 0); } } });
  addEventListener('resize', () => setTimeout(() => { paintCard(); if (big) { const W = big.cv.clientWidth, H = big.cv.clientHeight; big.v0 = fit(big.P, W, H, 30); paintBig(); } }, 200));

  /* ===== branchement : la carte s'ajoute en bas de l'onglet Conduite (tab 6) ===== */
  try {
    const _r = render;
    render = function () {
      const x = _r.apply(this, arguments);
      try {
        if (typeof tab !== 'undefined' && tab == 6) {
          const m = document.getElementById('main');
          if (m && !document.getElementById('lc_card')) { m.insertAdjacentHTML('beforeend', window.mrLeanCard()); setTimeout(paintCard, 0); }
        }
      } catch (e) { console.warn('inclinaison', e); }
      return x;
    };
  } catch (e) { console.warn('inclinaison : branchement', e); }

  const st = document.createElement('style');
  st.textContent = `.lc-wrap{position:relative;margin:8px 0}.lc-cv{display:block;width:100%;height:260px;border-radius:14px;background:radial-gradient(120% 90% at 30% 10%,#26303a,#12161b);cursor:zoom-in}
.lc-big{position:absolute;right:8px;bottom:8px;min-height:40px;padding:6px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.35);background:rgba(15,18,22,.8);color:#fff;font-weight:700}
[dir=rtl] .lc-big{right:auto;left:8px}
.lc-leg{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px;color:var(--mute,#888);margin:6px 0}.lc-leg span{display:inline-flex;align-items:center;gap:5px}.lc-leg i{width:16px;height:5px;border-radius:3px;display:inline-block}
.lc-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:8px 0}.lc-stats div{border:1px solid var(--line,#333);border-radius:12px;padding:8px;text-align:center}.lc-stats b{display:block;font-size:20px}.lc-stats small{color:var(--mute,#888)}
.lc-bar{display:flex;height:12px;border-radius:7px;overflow:hidden;background:var(--line,#333)}.lc-bar i{display:block;height:100%}
.lc-turn{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;margin:6px 0;padding:8px 10px;border-radius:12px;border:1px solid var(--line,#333);background:transparent;color:inherit;text-align:start;font:inherit}
.lc-turn small{color:var(--mute,#888)}.lc-n{flex:0 0 30px;height:30px;border-radius:50%;border:2px solid;display:grid;place-items:center;font-size:13px}.lc-z{margin-inline-start:auto;opacity:.6;font-size:18px}
.lc-dl{box-sizing:border-box;width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;margin:0;padding:10px;border:0;background:#0f1216;color:#eef2f5;display:flex;flex-direction:column;gap:6px}
.lc-dl:not([open]){display:none}.lc-dl::backdrop{background:#000}.lc-hd{display:flex;justify-content:space-between;align-items:center;gap:8px}
.lc-map{position:relative;flex:1 1 55%;min-height:240px}.lc-map canvas{width:100%;height:100%;display:block;border-radius:14px;background:radial-gradient(120% 90% at 30% 10%,#26303a,#12161b)}
.lc-zb{position:absolute;right:8px;top:44px;display:flex;flex-direction:column;gap:6px}[dir=rtl] .lc-zb{right:auto;left:8px}.lc-hd .g{min-height:44px}
.lc-zb button{width:48px;height:48px;border-radius:12px;border:1px solid rgba(255,255,255,.3);background:rgba(15,18,22,.85);color:#fff;font-size:22px;font-weight:700}
.lc-info{position:absolute;left:8px;right:64px;bottom:8px;padding:8px 10px;border-radius:10px;background:rgba(15,18,22,.85);font-size:14px;line-height:1.35}
[dir=rtl] .lc-info{right:8px;left:64px}
.lc-cal{margin:10px 0;padding-top:8px;border-top:1px solid var(--line,#333)}.lc-cal input{min-height:44px}.lc-pcv{width:100%;height:70px;display:block;border-radius:10px;background:#161b21}.lc-list{flex:0 1 30%;overflow:auto}`;
  document.head.appendChild(st);
})();
