/* MotoRoute test-73 (01/11/2026, décision d'Elaid) : la fiche d'urgence est synchronisée avec le compte
   (table emergency_cards, une ligne par membre, visible par lui seul : règle « ice_owner »).
   - Enregistrer la fiche l'envoie au serveur.
   - À la connexion : si le téléphone n'a pas de fiche (nouveau téléphone, réinstallation), on reprend celle du compte ;
     si les deux existent, la plus récente gagne.
   - Le 2e numéro est rangé avec le 1er dans contact_phone, séparés par « / ». */
(function () {
  var sb = function () { return window.mrSb || null; };
  var user = function () { try { return (window.mrUser && window.mrUser()) || null; } catch (e) { return null; } };
  var clean = function (v) { return String(v == null ? '' : v).trim().slice(0, 200); };
  var empty = function (i) { return !i || !(i.name || i.blood || i.contact || i.phone || i.phone2 || i.allergy); };

  function toRow(i, uid) {
    var ph = [clean(i.phone), clean(i.phone2)].filter(Boolean).join(' / ');
    return { user_id: uid, full_name: clean(i.name), blood_type: clean(i.blood), contact_name: clean(i.contact),
             contact_phone: ph, allergies: clean(i.allergy), updated_at: new Date().toISOString() };
  }
  function fromRow(r) {
    var p = String(r.contact_phone || '').split('/').map(function (x) { return x.trim(); });
    return { name: r.full_name || '', blood: r.blood_type || '', contact: r.contact_name || '',
             phone: p[0] || '', phone2: p[1] || '', allergy: r.allergies || '' };
  }

  // test-98 : fiche vidée par le membre → on l'efface aussi du compte (avant, l'ancienne revenait au lancement suivant)
  async function wipe() {
    var c = sb(), u = user(); if (!c || !u) return false;
    var r = await c.from('emergency_cards').delete().eq('user_id', u.id);
    if (r.error) { console.error('fiche urgence (effacement)', r.error.message); return false; }
    S.iceCleared = false; S.iceSync = u.id; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    return true;
  }
  async function push() {
    var c = sb(), u = user(); if (!c || !u) return false;
    if (empty(S.ice)) { return S.iceCleared ? wipe() : false; }
    var r = await c.from('emergency_cards').upsert(toRow(S.ice, u.id), { onConflict: 'user_id' });
    if (r.error) { console.error('fiche urgence', r.error.message); return false; }
    S.iceSync = u.id; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    return true;
  }

  var pulledFor = null;
  async function pull() {
    var c = sb(), u = user(); if (!c || !u || pulledFor == u.id) return;
    pulledFor = u.id;
    var r = await c.from('emergency_cards').select('*').eq('user_id', u.id).maybeSingle();
    if (r.error) { pulledFor = null; return; }
    var row = r.data, local = S.ice, lAt = +S.iceAt || 0;
    // 05/11/2026 : fiche locale venant d'un AUTRE compte (changement de compte sur ce téléphone) :
    // on ne l'envoie jamais sur le nouveau compte ; on la remplace par celle du compte, ou on la vide.
    if (S.iceSync && S.iceSync !== u.id) {
      if (row) { S.ice = fromRow(row); S.iceAt = new Date(row.updated_at).getTime(); }
      else { S.ice = {}; S.iceAt = 0; }
      S.iceSync = row ? u.id : null;
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
      try { render(); } catch (e) {}
      try { window.smsSync && window.smsSync(); } catch (e) {}
      return;
    }
    // fiche vidée sur ce téléphone (même compte) plus récemment que celle du serveur : on efface au lieu de la reprendre
    if (row && empty(local) && S.iceCleared && S.iceSync === u.id && lAt >= new Date(row.updated_at).getTime()) { await wipe(); return; }
    if (row && (empty(local) || new Date(row.updated_at).getTime() > lAt)) {
      S.ice = fromRow(row); S.iceAt = new Date(row.updated_at).getTime(); S.iceSync = u.id;
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
      try { render(); } catch (e) {}
      try { window.smsSync && window.smsSync(); } catch (e) {}
    } else if (!empty(local) && (!row || lAt > new Date(row.updated_at).getTime() || !S.iceSync)) {
      await push();
    }
  }

  // Enregistrer la fiche = l'envoyer au compte
  if (typeof saveIce == 'function') {
    var _save = saveIce;
    saveIce = function () { _save.apply(this, arguments); S.iceAt = Date.now(); S.iceCleared = empty(S.ice); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} push(); };
  }
  setInterval(pull, 10000);
  setTimeout(pull, 3000);
  window.mrIceSync = { push: push, pull: pull };
})();
