/* test-59 : écran stable — l'onglet n'est plus effacé puis recréé en entier à chaque mise à jour.
   Quand l'app redessine le contenu principal (<main>), on garde à l'écran les cartes qui n'ont pas changé
   (photos, vidéos et défilement restent en place) et on ne remplace que celles qui ont changé.
   Une carte où le membre est en train d'écrire (champ modifié) est remplacée comme avant, pour ne rien casser. */
(function () {
  const m = document.getElementById('main');
  if (!m || m.__mrStable) return;
  const D = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!D || !D.set || !D.get) return;
  m.__mrStable = true;

  const dirty = el => {
    if (!el.querySelectorAll) return false;
    const f = el.matches && el.matches('input,textarea,select') ? [el] : [];
    const all = f.concat([...el.querySelectorAll('input,textarea,select')]);
    for (const c of all) {
      if (c.tagName == 'SELECT') { for (const o of c.options) if (o.selected != o.defaultSelected) return true; continue; }
      if (c.type == 'checkbox' || c.type == 'radio') { if (c.checked != c.defaultChecked) return true; continue; }
      if (c.type == 'file') { if (c.files && c.files.length) return true; continue; }
      if (c.value != c.defaultValue) return true;
    }
    return false;
  };
  const curTab = () => { try { return typeof tab != 'undefined' ? tab : null; } catch (e) { return null; } };
  const curGid = () => { try { return typeof gid != 'undefined' ? gid : null; } catch (e) { return null; } };
  const curLang = () => { try { return typeof lang != 'undefined' ? lang : ''; } catch (e) { return ''; } };
  let lastTab = curTab(), lastGid = curGid(), lastLang = curLang();

  // Éléments qu'on peut mettre à jour « de l'intérieur » (on garde l'élément, on ne change que ce qui diffère)
  const DEEP = /^(DIV|SECTION|ARTICLE|HEADER|FOOTER|SPAN|P|H1|H2|H3|H4|H5|H6|UL|OL|LI|A|BUTTON|LABEL|B|I|SMALL|STRONG|EM|DETAILS|SUMMARY|TABLE|THEAD|TBODY|TR|TD|TH|FIGURE|FIGCAPTION|NAV)$/;
  const busy = n => dirty(n) || (document.activeElement && document.activeElement !== document.body && n.contains(document.activeElement));

  function syncAttrs(o, n) {
    for (const a of [...o.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
    for (const a of [...n.attributes]) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
  }
  function kids(box, freshList) {
    const old = [...box.childNodes];
    const used = new Set();
    const exact = new Map();
    for (const n of old) {
      if (n.nodeType != 1 || busy(n)) continue;
      const k = n.outerHTML; if (!exact.has(k)) exact.set(k, []); exact.get(k).push(n);
    }
    const want = freshList.map(n => {
      if (n.nodeType == 3) { // texte : on garde le même nœud s'il est identique
        const t = old.find(o => o.nodeType == 3 && !used.has(o) && o.data === n.data);
        if (t) { used.add(t); return t; }
        return n;
      }
      if (n.nodeType != 1) return n;
      const l = exact.get(n.outerHTML);
      while (l && l.length) { const o = l.shift(); if (!used.has(o)) { used.add(o); return o; } }
      if (DEEP.test(n.tagName)) { // même genre de bloc : on le met à jour au lieu de le recréer (les photos dedans ne clignotent plus)
        const o = old.find(o => o.nodeType == 1 && !used.has(o) && o.tagName === n.tagName && o.className === n.className && (o.id || '') === (n.id || '') && !busy(o));
        if (o) { used.add(o); syncAttrs(o, n); kids(o, [...n.childNodes]); return o; }
      }
      return n;
    });
    let ref = box.firstChild;
    for (const w of want) {
      if (w === ref) { ref = ref.nextSibling; continue; }
      box.insertBefore(w, ref);
    }
    while (ref) { const nx = ref.nextSibling; box.removeChild(ref); ref = nx; }
  }

  function morph(html) {
    const tpl = document.createElement('template');
    D.set.call(tpl, String(html));
    const fresh = [...tpl.content.childNodes];
    // La carte « Proposer un itinéraire » vit sa propre vie (ville tapée, résultats) : on la garde en tête
    const it = document.getElementById('mrItCard');
    if (it && it.parentNode === m) {
      const k = fresh.findIndex(n => n.nodeType == 1 && n.id == 'mrItCard');
      if (k >= 0) fresh[k] = it; else fresh.unshift(it);
    }
    kids(m, fresh);
  }

  Object.defineProperty(m, 'innerHTML', {
    configurable: true,
    get() { return D.get.call(this); },
    set(v) {
      const t = curTab(), g = curGid(), L = curLang();
      const same = t === lastTab && String(g) === String(lastGid) && L === lastLang;
      lastTab = t; lastGid = g; lastLang = L;
      if (!same) { D.set.call(this, v); return; } // changement d'onglet / de langue : affichage complet comme avant
      const y = window.scrollY;
      try { morph(v); } catch (e) { console.error('ecran-stable', e); D.set.call(this, v); }
      // les modules ajoutent encore des boutons juste après : on remet le défilement en place avant l'affichage
      const fix = () => { if (curTab() === t && Math.abs(window.scrollY - y) > 1) { try { window.scrollTo(0, y); } catch (e) {} } };
      fix(); requestAnimationFrame(fix);
    }
  });
})();
