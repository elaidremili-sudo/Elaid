// Portage fidèle de l'algorithme d'inclinaison de test-65 (index.html, module Conduite) pour comparaison.
(function (root) {
  const R2 = Math.PI / 180;
  function create(o) {
    o = o || {};
    let U = o.U || null, Ug = null, lTs = 0, wBi = 0, looseT = 0, lastB = null, leanU = 0, lss = 0, lssP = 0, rr = 0, fAx = null, fN = 0, fCor = 0, lean = 0, spd = 0;
    const gH = [], wB = [], bH = [], oH = [], rH = [], C3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let looseMs = 0, rideMs = 0;
    function gpsLean(n, ms) { const v = gH.filter(h => n - h[0] <= ms).map(h => h[1]).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null }
    function leanCap(n) { const c = gpsLean(n, 3000); return c == null ? 12 : c < 4 ? 5 : Math.min(62, c * 1.15 + 8) }
    function learnAxis(gp) { const m = Math.hypot(...gp); if (m < .15 || m > 4) return; for (let i = 0; i < 3; i++)for (let j = 0; j < 3; j++)C3[i][j] = C3[i][j] * .998 + gp[i] * gp[j]; fN++;
      let v = fAx || [gp[0] / m, gp[1] / m, gp[2] / m]; for (let k = 0; k < 3; k++) { const w = [0, 1, 2].map(i => C3[i][0] * v[0] + C3[i][1] * v[1] + C3[i][2] * v[2]); const q = Math.hypot(...w) || 1; v = w.map(x => x / q) }
      if (fAx && v[0] * fAx[0] + v[1] * fAx[1] + v[2] * fAx[2] < 0) v = v.map(x => -x); fAx = v }
    function motion(x, y, z, al, be, ga, n) {
      const h = Math.hypot(x, y, z); if (h > 6 && h < 14) { const v = [x / h, y / h, z / h]; if (!Ug) Ug = U ? U.slice() : v; else { const k = .006; Ug = Ug.map((q, i) => q * (1 - k) + v[i] * k); const m = Math.hypot(...Ug); Ug = Ug.map(q => q / m) } }
      if (!U) return; const dt = lTs ? Math.min(.2, (n - lTs) / 1000) : .016; lTs = n;
      if (spd < 15) { lean *= .9; leanU *= .9; lss *= .9; return }
      rideMs += dt * 1000; if (looseT && n - looseT < 1000) looseMs += dt * 1000;
      const A = Ug || U, gv = [be * R2, ga * R2, al * R2], w0 = gv[0] * A[0] + gv[1] * A[1] + gv[2] * A[2];
      { const gl = gpsLean(n, 2500); if (gl != null && gl < 2 && Math.abs(w0 - wBi) < .15) wBi = wBi * .9995 + w0 * .0005 }
      const w = w0 - wBi, vm = spd / 3.6, raw = Math.asin(Math.max(-.883, Math.min(.883, vm * w / 9.81))) / R2;
      lss = lss * .85 + raw * .15;
      const gp = [gv[0] - w0 * A[0], gv[1] - w0 * A[1], gv[2] - w0 * A[2]]; learnAxis(gp);
      rr = rr * .6 + (fAx ? (gp[0] * fAx[0] + gp[1] * fAx[1] + gp[2] * fAx[2]) / R2 : 0) * .4;
      const dL = (lss - lssP) / dt; lssP = lss; if (fAx && Math.abs(dL) < 200) fCor = fCor * .999 + rr * dL * dt;
      const sg = fCor < 0 ? -1 : 1, ok = fAx && fN > 300 && Math.abs(fCor) > 20;
      wB.push([n, w]); while (wB.length && n - wB[0][0] > 800) wB.shift();
      const wm = wB.reduce((p, q) => p + q[1], 0) / wB.length, wsd = Math.sqrt(wB.reduce((p, q) => p + (q[1] - wm) ** 2, 0) / wB.length);
      if (Math.abs(leanU) > 12) { const s2 = Math.sign(leanU); if (!rH.length || rH[rH.length - 1][1] != s2) rH.push([n, s2]) } while (rH.length && n - rH[0][0] > 4000) rH.shift();
      let g4 = 0; for (const hh of gH) if (n - hh[0] <= 4500) g4 = Math.max(g4, hh[1]);
      if ((wsd > .8 || rH.length >= 2) && gH.length && g4 < 4) looseT = n;
      const K = ok ? 1.2 / (1.2 + dt) : 0; let t = ok ? K * (lean + sg * rr * dt) + (1 - K) * lss : lean * .9 + lss * .1;
      const mx = 90 * dt; t = Math.max(lean - mx, Math.min(lean + mx, t)); const cap = looseT && n - looseT < 20000 ? leanCap(n) : 62; lean = Math.max(-cap, Math.min(cap, t));
      leanU = Math.max(-62, Math.min(62, leanU * .9 + raw * .1))
    }
    const hv = (a, b) => { const r = Math.PI / 180, dl = (b[0] - a[0]) * r, dn = (b[1] - a[1]) * r, x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)) };
    function gps(lat, lng, speed, heading, n) {
      const pt = [lat, lng]; const v = speed;
      const br = (q, w) => { const R = Math.PI / 180, y = Math.sin((w[1] - q[1]) * R) * Math.cos(w[0] * R), x = Math.cos(q[0] * R) * Math.sin(w[0] * R) - Math.sin(q[0] * R) * Math.cos(w[0] * R) * Math.cos((w[1] - q[1]) * R); return Math.atan2(y, x) / R };
      let hd = null; const sp = Math.max(0, v);
      if (heading != null && !isNaN(heading) && sp > 4) hd = heading;
      else if (lastB && hv(lastB, pt) * 1000 >= Math.max(20, sp * 1.5)) { hd = br(lastB, pt); lastB = pt }
      if (!lastB) lastB = pt;
      if (hd != null) { bH.push([n, hd]); while (bH.length && n - bH[0][0] > 8000) bH.shift();
        let ob = null; for (let i = bH.length - 2; i >= 0; i--) if (n - bH[i][0] >= 2000) { ob = bH[i]; break }
        if (ob) { let d = hd - ob[1]; d = ((d + 540) % 360) - 180; oH.push(d * R2 / ((n - ob[0]) / 1000)); while (oH.length > 3) oH.shift();
          const md = oH.length < 3 ? 0 : oH.slice().sort((p, q) => p - q)[1], g0 = sp < 4 ? 0 : Math.atan(sp * Math.abs(md) / 9.81) / R2;
          gH.push([n, Math.min(62, g0)]); while (gH.length && n - gH[0][0] > 6000) gH.shift() } }
      spd = Math.max(0, v * 3.6);
    }
    function display(n) { return lean }
    return { motion, gps, display, get lean() { return lean }, get looseNow() { return !!looseT && Date.now() - looseT < 5000 }, looseAt: (n) => !!looseT && n - looseT < 5000, stats: () => ({ looseMs, rideMs }) };
  }
  const api = { create, version: 'v1' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MrLeanV1 = api;
})(typeof window !== 'undefined' ? window : this);
