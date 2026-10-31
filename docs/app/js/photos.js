/* MotoRoute – Choisir des photos (test-57, 24/10/2026)
   Problème signalé par Elaid : « Parcourir » ouvrait le sélecteur de documents d'Android (Drive, « Récents »)
   au lieu des vraies photos du téléphone. Dans l'app Android, on passe maintenant par le module Caméra
   de Capacitor : « Galerie » ouvre le sélecteur de photos du téléphone (Photos + Albums, dont Appareil photo,
   WhatsApp, Captures…), « Photo » ouvre l'appareil photo. Dans le navigateur (iPhone / web), on garde le
   champ fichier classique (sur iPhone il propose déjà Photothèque / Prendre une photo).
   Utilisation : const urls = await mrPickPhotos('gallery' | 'camera', max)  → images JPEG réduites (data:…). */
(function () {
  'use strict';
  const cam = () => { try { return window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.Plugins && Capacitor.Plugins.Camera; } catch (e) { return null; } };

  function shrinkSrc(src, maxSide) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, (maxSide || 1200) / Math.max(im.width, im.height));
        const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.8));
      };
      im.onerror = rej; im.src = src;
    });
  }
  const fileToUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

  function viaInput(source, max) {
    return new Promise(res => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = 'image/*'; if (source === 'camera') i.capture = 'environment'; else if (max > 1) i.multiple = true;
      i.style.display = 'none'; document.body.appendChild(i);
      let done = false;
      const end = async () => {
        if (done) return; done = true;
        const fs = Array.from(i.files || []).slice(0, max), out = [];
        for (const f of fs) { try { out.push(await shrinkSrc(await fileToUrl(f))); } catch (e) {} }
        i.remove(); res(out);
      };
      i.onchange = end;
      window.addEventListener('focus', () => setTimeout(() => { if (!i.files || !i.files.length) { done = true; i.remove(); res([]); } }, 1500), { once: true });
      i.click();
    });
  }

  async function viaCamera(C, source, max) {
    try {
      if (source === 'camera') {
        const p = await C.getPhoto({ source: 'CAMERA', resultType: 'dataUrl', quality: 80, width: 1600, correctOrientation: true, saveToGallery: false });
        return p && p.dataUrl ? [await shrinkSrc(p.dataUrl)] : [];
      }
      if (max <= 1) {
        const p = await C.getPhoto({ source: 'PHOTOS', resultType: 'dataUrl', quality: 80, width: 1600, correctOrientation: true });
        return p && p.dataUrl ? [await shrinkSrc(p.dataUrl)] : [];
      }
      const r = await C.pickImages({ quality: 80, width: 1600, limit: max, correctOrientation: true });
      const out = [];
      for (const ph of (r && r.photos || []).slice(0, max)) { try { out.push(await shrinkSrc(ph.webPath)); } catch (e) {} }
      return out;
    } catch (e) {
      const m = String(e && e.message || e);
      if (/cancel|annul|No image picked|User cancelled/i.test(m)) return [];
      throw e;
    }
  }

  window.mrPickPhotos = async function (source, max) {
    max = Math.max(1, max || 1);
    const C = cam();
    if (C) { try { return await viaCamera(C, source, max); } catch (e) { console.warn('photos natif', e); } }
    return viaInput(source, max);
  };
  window.mrShrinkPhoto = shrinkSrc;

  /* test-71 (bilan A2) : miniatures pour les listes.
     À l'envoi, chaque photo est rangée deux fois : la photo (1200 px) et une miniature de 400 px « …-t.jpg ».
     Les listes affichent la miniature, le grand format seulement quand on touche la photo.
     Les deux sont gardées 1 an en mémoire par le téléphone (cacheControl), au lieu d'1 heure.
     Anciennes photos sans miniature : on retombe automatiquement sur la photo (voir l'écouteur « error » plus bas). */
  const YEAR = '31536000';
  const toBlob = async d => (await fetch(d)).blob();
  window.mrThumbUrl = u => String(u || '').replace(/\.jpg(\?.*)?$/i, '-t.jpg$1');
  window.mrThumbImg = (u, attrs) => {
    const e = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return `<img src="${e(window.mrThumbUrl(u))}" data-full="${e(u)}" loading="lazy" decoding="async" alt="" ${attrs || ''}>`;
  };
  window.mrUploadPhoto = async function (c, bucket, uid, dataUrl) {
    const base = uid + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const r = await c.storage.from(bucket).upload(base + '.jpg', await toBlob(dataUrl), { contentType: 'image/jpeg', upsert: false, cacheControl: YEAR });
    if (r.error) throw r.error;
    try {
      const t = await shrinkSrc(dataUrl, 400);
      await c.storage.from(bucket).upload(base + '-t.jpg', await toBlob(t), { contentType: 'image/jpeg', upsert: false, cacheControl: YEAR });
    } catch (e) { /* sans miniature, la liste affichera la photo */ }
    return c.storage.from(bucket).getPublicUrl(base + '.jpg').data.publicUrl;
  };
  /* chemins à effacer : la photo et sa miniature */
  window.mrPhotoPaths = function (urls, bucket) {
    const out = [];
    (urls || []).forEach(u => {
      const p = String(u).split('/' + bucket + '/')[1]; if (!p) return;
      const d = decodeURIComponent(p.split('?')[0]); out.push(d);
      if (/\.jpg$/i.test(d) && !/-t\.jpg$/i.test(d)) out.push(d.replace(/\.jpg$/i, '-t.jpg'));
    });
    return out;
  };
  document.addEventListener('error', ev => {
    const i = ev.target;
    if (i && i.tagName === 'IMG' && i.dataset && i.dataset.full && i.getAttribute('src') !== i.dataset.full) i.src = i.dataset.full;
  }, true);
})();
