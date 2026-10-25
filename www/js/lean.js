/* MotoRoute — mesure de l'inclinaison (test-66, 25/10/2026).
   Même méthode que test-50 (études TU Darmstadt / IFZ 2020, Schlipsing 2012) : filtre complémentaire entre
   1) la vitesse de roulis du gyroscope (réaction immédiate) et
   2) l'angle d'équilibre tiré du virage : sin(angle) = vitesse × lacet mesuré dans le repère de la moto / g,
   avec le garde-fou GPS (ligne droite → 0°).
   Nouveautés test-66 (retours d'Elaid : alerte « le téléphone bouge » sans arrêt sur le support, angle instable) :
   - filtre anti-vibrations : chaque axe du gyroscope et de l'accéléromètre passe par un filtre passe-bas d'ordre 2
     (coupure ~3 Hz) avant tout calcul. Les vibrations du moteur, du support, du vent et de la route (≥ 8 Hz) sont gommées ;
     les vrais mouvements de la moto (< 2 Hz) passent intacts ;
   - détection « téléphone tenu en main / mal fixé » faite sur le signal filtré, avec une sensibilité réglable
     (faible / normale / forte) et une durée minimale ; plus aucune alerte pendant le trajet, seulement un conseil à l'arrêt ;
   - valeur affichée = médiane des 0,4 dernières secondes (plus de chiffres qui sautent).
   Module autonome (sans écran) : utilisé par index.html et par le banc d’essai scripts/banc/ (node scripts/banc/comparer.js). */
(function (root) {
  'use strict';
  const R2 = Math.PI / 180;
  // sensibilité de la détection « téléphone qui bouge » : multiplie les seuils
  const SENS = { faible: 1.6, normale: 1, forte: 0.7 };

  // filtre passe-bas d'ordre 2 (deux étages du 1er ordre), robuste aux écarts d'échantillonnage du navigateur
  function lp2(fc) {
    const tau = 1 / (2 * Math.PI * fc);
    let a = null, b = null;
    return {
      step(x, dt) {
        if (a == null) { a = x; b = x; return x; }
        const k = dt / (tau + dt);
        a += (x - a) * k; b += (a - b) * k; return b;
      },
      reset() { a = b = null; }
    };
  }
  const lp3 = fc => { const f = [lp2(fc), lp2(fc), lp2(fc)]; return { step: (v, dt) => v.map((x, i) => f[i].step(x, dt)), reset: () => f.forEach(z => z.reset()) }; };

  function create(o) {
    o = o || {};
    let U = o.U && o.U.length === 3 ? o.U.slice() : null;
    const KT = o.kt || 1.2, LT = o.lt || .25; // constantes du filtre (réglées sur le banc d'essai)
    let sens = SENS[o.sens] ? o.sens : 'normale';
    // état qui survit d'un trajet à l'autre
    let Ug = null, wBi = 0, fAx = null, nn = 0, fwN = 0;
    const fw = [0, 0, 0]; // axe avant de la moto, appris aux accélérations / freinages en ligne droite
    const cv = [0, 0, 0];
    // axe appris lors des trajets précédents (format test-50 : a = axe, c = sens) : point de départ, vite confirmé ou corrigé
    if (o.rollAx && o.rollAx.a && o.rollAx.a.length === 3) { const sg0 = o.rollAx.c < 0 ? -1 : 1; for (let i = 0; i < 3; i++) cv[i] = o.rollAx.a[i] * sg0 * .3; nn = .3; fAx = cv.map(x => x / .3); }
    const fG = lp3(3), fA = lp3(2), fD = lp3(1), fW = lp2(1);
    let dbg = {}, lastAf = null;
    // état d'un trajet
    let active = false, lTs = 0, spd = 0, lean = 0, leanU = 0, lss = 0, lssP = 0, rr = 0, looseT = 0, looseS = 0, lastB = null;
    let looseMs = 0, rideMs = 0, vibSum = 0, vibN = 0, gAcc = 0, gAccT = 0, gAccN = 0, spP = null, spPT = 0;
    const gH = [], wB = [], bH = [], oH = [], rH = [], dH = [], aB = [];

    function gpsLean(n, ms) { const v = gH.filter(h => n - h[0] <= ms).map(h => h[1]).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; }
    function leanCap(n) { const c = gpsLean(n, 3000); return c == null ? 12 : c < 4 ? 5 : Math.min(62, c * 1.15 + 8); }
    // axe de roulis (test-66) : direction de rotation du téléphone qui accompagne les changements de l'angle d'équilibre.
    // Covariance entre la rotation perpendiculaire à la verticale et la variation de l'angle d'équilibre : les vibrations
    // et le tangage (bosses, freinages) ne sont pas liés au virage, ils s'annulent ; le sens de l'axe sort tout seul.
    function learnAxis(gp, dLr, dt) {
      if (Math.abs(dLr) > 3.5) return; // > 200 °/s : mesure aberrante
      const k = Math.exp(-dt / 120); // mémoire ~2 min de conduite
      for (let i = 0; i < 3; i++) cv[i] = cv[i] * k + gp[i] * dLr * dt;
      nn = nn * k + dLr * dLr * dt;
      const m = Math.hypot(cv[0], cv[1], cv[2]);
      if (m > 1e-6) fAx = [cv[0] / m, cv[1] / m, cv[2] / m];
    }
    // test-66 : l'axe avant est mesuré directement quand la moto accélère ou freine en ligne droite (l'accéléromètre
    // penche vers l'avant/l'arrière, le GPS donne le sens). Il ne se mélange plus au tangage qui accompagne les virages
    // (cause d'un excès de 5 à 8° en virage serré). La covariance ne sert plus qu'à confirmer le sens du roulis.
    function learnFwd(af, A, n, dt) {
      if (!gAccN || n - gAccN > 1500 || Math.abs(gAcc) < .7) return;
      let g4 = 0; for (const q of gH) if (n - q[0] <= 3000) g4 = Math.max(g4, Math.abs(q[1])); if (g4 > 4) return;
      const d = af[0] * A[0] + af[1] * A[1] + af[2] * A[2], hz = [af[0] - d * A[0], af[1] - d * A[1], af[2] - d * A[2]], m = Math.hypot(hz[0], hz[1], hz[2]);
      if (m < .3 * Math.abs(gAcc) || m > 3 * Math.abs(gAcc) + 1) return; // ne ressemble pas à l'accélération vue par le GPS
      const s = gAcc > 0 ? 1 : -1, k = Math.exp(-dt / 600);
      for (let i = 0; i < 3; i++) fw[i] = fw[i] * k + s * hz[i] * dt; // pondéré par l'accélération : le bruit s'annule
      fwN = fwN * k + Math.abs(gAcc) * dt;
    }
    function rollAxis(A) {
      if (fwN > 4) { // ~2 s d'accélération franche (2 m/s²)
        const m0 = Math.hypot(fw[0], fw[1], fw[2]);
        if (m0 > .5 * fwN) { // mesures cohérentes entre elles
          const d = (fw[0] * A[0] + fw[1] * A[1] + fw[2] * A[2]) / m0; let x = [fw[0] / m0 - d * A[0], fw[1] / m0 - d * A[1], fw[2] / m0 - d * A[2]];
          const mx = Math.hypot(x[0], x[1], x[2]); if (mx > .5) { x = x.map(v => v / mx);
            // sens du roulis : donné par la covariance si elle est nette, sinon convention Android (pencher à gauche = rotation négative autour de l'avant)
            const c = cv[0] * x[0] + cv[1] * x[1] + cv[2] * x[2], cm = Math.hypot(cv[0], cv[1], cv[2]);
            const sg = cm > 1e-6 && Math.abs(c) > .5 * cm && nn > .1 ? Math.sign(c) : -1;
            return x.map(v => v * sg); }
        }
      }
      return axOk() ? fAx : null;
    }
    const axOk = () => fAx && nn > .25;

    function resetRide() {
      gAcc = 0; gAccT = 0; gAccN = 0; spP = null; spPT = 0;
      lTs = 0; spd = 0; lean = 0; leanU = 0; lss = 0; lssP = 0; rr = 0; looseT = 0; looseS = 0; lastB = null;
      looseMs = 0; rideMs = 0; vibSum = 0; vibN = 0;
      gH.length = wB.length = bH.length = oH.length = rH.length = dH.length = aB.length = 0; wBi = 0;
      fG.reset(); fA.reset(); fD.reset(); fW.reset();
    }

    // x, y, z : accélération incluant la gravité (m/s², vers le haut) ; al, be, ga : rotationRate du navigateur (°/s) ; n : ms
    function motion(x, y, z, al, be, ga, n) {
      const dt = lTs ? Math.max(.001, Math.min(.2, (n - lTs) / 1000)) : .016; lTs = n;
      // vibrations mesurées (écart entre le signal brut et le signal filtré) : pour le conseil de fin de trajet
      const af = fA.step([x, y, z], dt); lastAf = af;
      const hr = Math.hypot(x - af[0], y - af[1], z - af[2]);
      if (active && spd >= 15) { vibSum += hr; vibN++; }
      const h = Math.hypot(af[0], af[1], af[2]);
      // direction de la gravité apparente, filtrée plus fort (1 Hz) pour reconnaître un téléphone en main (balancement lent)
      const ad1 = fD.step([x, y, z], dt), hd1 = Math.hypot(ad1[0], ad1[1], ad1[2]);
      if (active && hd1 > 4) { aB.push([n, ad1[0] / hd1, ad1[1] / hd1, ad1[2] / hd1]); while (aB.length && n - aB[0][0] > 1500) aB.shift(); }
      if (h > 6 && h < 14) {
        const v = [af[0] / h, af[1] / h, af[2] / h];
        if (!Ug) Ug = U ? U.slice() : v;
        else { const k = Math.min(.05, .36 * dt); Ug = Ug.map((q, i) => q * (1 - k) + v[i] * k); const m = Math.hypot(Ug[0], Ug[1], Ug[2]); Ug = Ug.map(q => q / m); }
      }
      const gv = fG.step([(be || 0) * R2, (ga || 0) * R2, (al || 0) * R2], dt);
      if (!active || !U) return;
      { const A0 = Ug && (Ug[0] * U[0] + Ug[1] * U[1] + Ug[2] * U[2]) < .985 ? Ug : U; learnFwd(ad1, A0, n, dt); }
      if (spd < 15) { lean *= .9; leanU *= .9; lss *= .9; dH.length = 0; return; }
      rideMs += dt * 1000;
      const A = Ug || U, w0 = gv[0] * A[0] + gv[1] * A[1] + gv[2] * A[2];
      // dérive du gyroscope : apprise quand le GPS voit une ligne droite, puis retirée
      { const gl = gpsLean(n, 2500); if (gl != null && gl < 2 && Math.abs(w0 - wBi) < .15) wBi = wBi * (1 - .03 * dt) + w0 * .03 * dt; }
      const w = w0 - wBi, vm = spd / 3.6, raw = Math.asin(Math.max(-.883, Math.min(.883, vm * w / 9.81))) / R2;
      const kl = Math.min(1, dt / LT); lss += (raw - lss) * kl; // angle d'équilibre lissé (~0,25 s : le bruit du lacet est multiplié par la vitesse)
      const gp = [gv[0] - w0 * A[0], gv[1] - w0 * A[1], gv[2] - w0 * A[2]];
      const dL = (lss - lssP) / dt; lssP = lss; learnAxis(gp, dL * R2, dt);
      const ax = rollAxis(A);
      rr = ax ? (gp[0] * ax[0] + gp[1] * ax[1] + gp[2] * ax[2]) / R2 : 0; // °/s (déjà filtré)
      const sg = 1, ok = !!ax;
      // téléphone tenu en main ou mal fixé : le gyroscope (filtré) s'agite alors que le GPS ne voit aucun virage
      wB.push([n, fW.step(w, dt)]); while (wB.length && n - wB[0][0] > 1500) wB.shift();
      let wm = 0; for (const q of wB) wm += q[1]; wm /= wB.length;
      let wv = 0; for (const q of wB) wv += (q[1] - wm) ** 2; const wsd = Math.sqrt(wv / wB.length);
      const S = SENS[sens];
      if (Math.abs(leanU) > 12 * S) { const s2 = Math.sign(leanU); if (!rH.length || rH[rH.length - 1][1] !== s2) rH.push([n, s2]); }
      while (rH.length && n - rH[0][0] > 4000) rH.shift();
      let g4 = 0; for (const q of gH) if (n - q[0] <= 4500) g4 = Math.max(g4, q[1]);
      // dispersion de la gravité apparente sur 1,5 s (degrés) : quasi nulle sur un support, même en virage
      let ad = 0; if (aB.length > 10) { let mx = 0, my = 0, mz = 0; for (const q of aB) { mx += q[1]; my += q[2]; mz += q[3]; } const mn = Math.hypot(mx, my, mz) || 1; mx /= mn; my /= mn; mz /= mn;
        let sq = 0; for (const q of aB) { const c = Math.max(-1, Math.min(1, q[1] * mx + q[2] * my + q[3] * mz)); sq += Math.acos(c) ** 2; } ad = Math.sqrt(sq / aB.length) / R2; }
      if (o.debug) dbg = { wsd, ad, rh: rH.length, g4, lss, rr, raw, ok: !!ok, fwN, fwM: Math.hypot(fw[0], fw[1], fw[2]), ax: ax && ax.map(v => +v.toFixed(2)) };
      // mesures sur le banc d'essai (p95, ligne droite) : support avec fortes vibrations ad ≈ 3-3,7° ; téléphone en main ad ≈ 7-8°
      const brk = gAccT && n - gAccT < 3000; // freinage ou accélération franche (GPS)
      const shaky = !brk && (ad > 5.5 * S || (wsd > .35 * S && ad > 4 * S) || (rH.length >= 4 && ad > 4.5 * S)) && gH.length && g4 < 4;
      // il faut que ça dure (0,8 s) : une bosse ou une rafale de vent ne suffit pas
      looseS = shaky ? looseS + dt : Math.max(0, looseS - dt * 2);
      if (looseS > .8) { looseT = n; looseMs += dt * 1000; }
      // filtre complémentaire : roulis intégré (court terme) + angle d'équilibre (long terme, constante 1,2 s)
      const K = ok ? KT / (KT + dt) : 0;
      let t = ok ? K * (lean + sg * rr * dt) + (1 - K) * lss : lean + (lss - lean) * Math.min(1, dt * 6);
      // ligne droite confirmée par le GPS pendant 3 s : on ramène doucement vers 0 (dérive, route abîmée, vent)
      { let gm = null; for (const q of gH) if (n - q[0] <= 3000) gm = Math.max(gm == null ? 0 : gm, Math.abs(q[1]));
        if (gm != null && gm < 2.5 && Math.abs(lss) < 6 && gH.length && n - gH[0][0] >= 2500) t -= t * Math.min(1, dt / 1.5); } // le gyroscope ne voit pas de virage non plus (le GPS a ~2 s de retard)
      const mx = 90 * dt; t = Math.max(lean - mx, Math.min(lean + mx, t));
      const cap = looseT && n - looseT < 20000 ? leanCap(n) : 62;
      lean = Math.max(-cap, Math.min(cap, t));
      leanU = Math.max(-62, Math.min(62, leanU + (raw - leanU) * Math.min(1, dt * 6)));
      dH.push([n, lean]); while (dH.length && n - dH[0][0] > 400) dH.shift();
    }

    const hv = (a, b) => { const r = R2, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r, x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
    const br = (q, w) => { const R = R2, y = Math.sin((w[1] - q[1]) * R) * Math.cos(w[0] * R), x = Math.cos(q[0] * R) * Math.sin(w[0] * R) - Math.sin(q[0] * R) * Math.cos(w[0] * R) * Math.cos((w[1] - q[1]) * R); return Math.atan2(y, x) / R; };
    // position GPS : vitesse en m/s, cap en degrés (null si absent), n en ms
    function gps(lat, lng, speed, heading, n) {
      const pt = [lat, lng], sp = Math.max(0, speed || 0);
      let hd = null;
      if (heading != null && !isNaN(heading) && sp > 4) hd = heading;
      else if (lastB && hv(lastB, pt) * 1000 >= Math.max(20, sp * 1.5)) { hd = br(lastB, pt); lastB = pt; }
      if (!lastB) lastB = pt;
      if (hd != null) {
        bH.push([n, hd]); while (bH.length && n - bH[0][0] > 8000) bH.shift();
        let ob = null; for (let i = bH.length - 2; i >= 0; i--) if (n - bH[i][0] >= 2000) { ob = bH[i]; break; }
        if (ob) {
          let d = hd - ob[1]; d = ((d + 540) % 360) - 180;
          oH.push(d * R2 / ((n - ob[0]) / 1000)); while (oH.length > 3) oH.shift();
          const md = oH.length < 3 ? 0 : oH.slice().sort((p, q) => p - q)[1], g0 = sp < 4 ? 0 : Math.atan(sp * Math.abs(md) / 9.81) / R2;
          gH.push([n, Math.min(62, g0)]); while (gH.length && n - gH[0][0] > 6000) gH.shift();
        }
      }
      if (spP != null && n > spPT) { const a = (sp - spP) / ((n - spPT) / 1000); if (Math.abs(a) > 1) gAccT = n; gAcc = a; gAccN = n; }
      spP = sp; spPT = n;
      spd = sp * 3.6;
    }

    // valeur à afficher : médiane des 0,4 dernières secondes (0 sous 15 km/h)
    function display() {
      if (spd < 15 || !dH.length) return 0;
      const v = dH.map(q => q[1]).sort((a, b) => a - b);
      return v[Math.floor(v.length / 2)];
    }

    return {
      motion, gps, display,
      start() { resetRide(); active = true; },
      stop() { active = false; },
      setU(u) { U = u && u.length === 3 ? u.slice() : null; Ug = U ? U.slice() : null; fAx = null; nn = 0; cv.fill(0); fw.fill(0); fwN = 0; },
      setSens(s) { if (SENS[s]) sens = s; },
      get lean() { return lean; },
      get leanU() { return leanU; },
      get speed() { return spd; },
      get dbg() { return dbg; },
      // angle (°) entre la gravité actuelle (filtrée) et la position calibrée « moto droite » : ~90° moto couchée
      tilt() { if (!U || !lastAf) return 0; const h = Math.hypot(lastAf[0], lastAf[1], lastAf[2]); if (h < 4) return 0;
        const c = (lastAf[0] * U[0] + lastAf[1] * U[1] + lastAf[2] * U[2]) / h; return Math.acos(Math.max(-1, Math.min(1, c))) / R2; },
      looseAt: n => !!looseT && n - looseT < 5000,
      rollAx: () => { const ax = rollAxis(Ug || U || [0, 0, 1]); return ax ? { a: ax.map(v => Math.round(v * 1e4) / 1e4), c: 1 } : null; },
      // bilan du trajet : part du temps où le téléphone bougeait, niveau moyen de vibrations (m/s²)
      stats: () => ({ looseMs: Math.round(looseMs), rideMs: Math.round(rideMs), loosePct: rideMs > 0 ? Math.round(100 * looseMs / rideMs) : 0, vib: vibN ? Math.round(10 * vibSum / vibN) / 10 : 0 })
    };
  }

  const api = { create, SENS: Object.keys(SENS), version: 'test-66' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MrLean = api;
})(typeof window !== 'undefined' ? window : this);
