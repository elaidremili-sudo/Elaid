/* MotoRoute – « Revoir mon trajet en 3D » (20/10/2026)
   Rejoue un trajet enregistré dans l'onglet Conduite : la route est reconstruite en 3D à partir du tracé GPS,
   posée sur la carte OpenStreetMap, et le pilote roule dessus à sa vraie vitesse avec sa vraie inclinaison.
   Caméras : 360° (on tourne autour du pilote), poursuite, drone, côté, cinéma (enchaîne les plans).
   Choix du tronçon A → B et enregistrement en vidéo (MP4/WebM) à partager. */
(function () {
  'use strict';
  const L = () => (typeof lang !== 'undefined' ? lang : 'fr');
  const W = (f, a, e) => (L() === 'ar' ? a : L() === 'en' ? e : f);
  const ESC = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const R_EARTH = 6378137, D2R = Math.PI / 180;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

  /* ================= Données ================= */
  const rides = () => (typeof S !== 'undefined' && Array.isArray(S.rides) ? S.rides : []);
  const hasTrack = r => r && Array.isArray(r.tk) && r.tk.length >= 8;

  function demoRide() {
    // Col fictif en lacets, façon montée vers Tikjda (Bouira) : ~9 km, altitude 900 → 1480 m
    const tk = [], lat0 = 36.4210, lng0 = 4.0950;
    let lat = lat0, lng = lng0, hd = 40 * D2R, t = 0, alt = 900;
    const segs = [[700, 0], [260, 70], [300, 0], [240, -165], [380, 0], [230, 160], [420, 15], [260, -95], [500, 0], [300, 120], [350, -20], [280, -140], [600, 10], [320, 90], [450, -30], [260, -120], [700, 0], [300, 60], [800, 0]];
    for (const [len, turn] of segs) {
      const n = Math.max(2, Math.round(len / 25));
      for (let i = 0; i < n; i++) {
        const step = len / n, dh = turn * D2R / n, rad = Math.abs(turn) > 0 ? len / Math.abs(turn * D2R) : 1e9;
        const v = turn ? clamp(Math.sqrt(9.81 * rad * Math.tan(38 * D2R)) * 3.6 * 0.9, 38, 95) : 92;
        hd += dh; lat += step * Math.cos(hd) / 111320; lng += step * Math.sin(hd) / (111320 * Math.cos(lat * D2R));
        t += step / (v / 3.6); alt += step * 0.065;
        const lean = turn ? Math.round(Math.atan((v / 3.6) ** 2 / (9.81 * rad)) / D2R) : 2;
        tk.push([+lat.toFixed(5), +lng.toFixed(5), lean, turn ? (turn > 0 ? 1 : -1) : 0, Math.round(v), Math.round(t), Math.round(alt)]);
      }
    }
    return { id: 'demo', demo: true, d: new Date().toISOString().slice(0, 10), tk, dur: Math.round(t) };
  }

  function prep(r) {
    // 1) points GPS → mètres locaux (Mercator, x = est, z = sud)
    let raw = r.tk.map(p => ({ lat: +p[0], lng: +p[1], lean: Math.abs(+p[2] || 0), side: p.length > 3 ? p[3] : undefined, v: p.length > 4 ? p[4] : null, t: p.length > 5 ? p[5] : null, alt: p.length > 6 ? p[6] : null }))
      .filter(p => isFinite(p.lat) && isFinite(p.lng));
    const lat0 = raw.reduce((s, p) => s + p.lat, 0) / raw.length, k = Math.cos(lat0 * D2R);
    const mx = lng => R_EARTH * lng * D2R * k, my = lat => R_EARTH * Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2)) * k;
    const X0 = mx(raw[0].lng), Y0 = my(raw[0].lat);
    const proj = (lat, lng) => [mx(lng) - X0, -(my(lat) - Y0)];
    raw.forEach(p => { const q = proj(p.lat, p.lng); p.x = q[0]; p.z = q[1]; });
    const pts = [raw[0]];
    for (let i = 1; i < raw.length; i++) { const a = pts[pts.length - 1], b = raw[i]; if (Math.hypot(b.x - a.x, b.z - a.z) >= 1.5) pts.push(b); }
    const n = pts.length; if (n < 4) return null;
    // 2) distance, temps, vitesse
    const d = [0]; for (let i = 1; i < n; i++) d.push(d[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const D = d[n - 1];
    let t;
    const tOk = pts.every((p, i) => p.t != null && isFinite(p.t) && (i === 0 || p.t >= pts[i - 1].t)) && pts[n - 1].t > pts[0].t;
    if (tOk) t = pts.map(p => p.t - pts[0].t);
    else { const dur = r.dur && r.dur > 10 ? r.dur : D / (55 / 3.6); t = d.map(x => x / D * dur); }
    for (let i = 1; i < n; i++) if (t[i] - t[i - 1] < 0.05) t[i] = t[i - 1] + 0.05;
    const v = pts.map((p, i) => {
      if (p.v != null && isFinite(p.v) && p.v > 0) return p.v;
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      return clamp((d[b] - d[a]) / Math.max(0.2, t[b] - t[a]) * 3.6, 0, 300);
    });
    // 3) altitude (si le téléphone l'a donnée sur au moins la moitié des points)
    const altN = pts.filter(p => p.alt != null && isFinite(p.alt)).length;
    let y = new Array(n).fill(0), hasAlt = false;
    if (altN >= n * 0.5) {
      hasAlt = true;
      let last = null; const a = pts.map(p => (p.alt != null && isFinite(p.alt) ? (last = p.alt) : last));
      let nxt = null; for (let i = n - 1; i >= 0; i--) { if (a[i] == null) a[i] = nxt; else nxt = a[i]; }
      const sm = a.map((_, i) => { let s = 0, c = 0; for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) { s += a[j]; c++; } return s / c; });
      const mn = Math.min(...sm); y = sm.map(v => v - mn);
    }
    // 4) courbe lissée, échantillonnée tous les ~2 m
    const P = pts.map((p, i) => ({ x: p.x, y: y[i], z: p.z }));
    const ns = clamp(Math.round(D / 2), 200, 12000);
    const S_ = [];
    const cr = (p0, p1, p2, p3, u) => { const u2 = u * u, u3 = u2 * u; return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3); };
    for (let s = 0; s <= ns; s++) {
      const fi = s / ns * (n - 1), i = Math.min(n - 2, Math.floor(fi)), u = fi - i;
      const a = P[Math.max(0, i - 1)], b = P[i], c = P[i + 1], e = P[Math.min(n - 1, i + 2)];
      const lerp = (A, B) => A + (B - A) * u;
      S_.push({ x: cr(a.x, b.x, c.x, e.x, u), y: lerp(b.y, c.y), z: cr(a.z, b.z, c.z, e.z, u), t: lerp(t[i], t[i + 1]), v: lerp(v[i], v[i + 1]), lm: Math.max(pts[i].lean, pts[i + 1].lean), sd: pts[i + 1].side, fi });
    }
    // 5) longueur, cap, courbure → inclinaison signée (+ = penché à gauche)
    S_[0].d = 0; for (let i = 1; i < S_.length; i++) S_[i].d = S_[i - 1].d + Math.hypot(S_[i].x - S_[i - 1].x, S_[i].z - S_[i - 1].z);
    const m = S_.length, hd = new Array(m);
    for (let i = 0; i < m; i++) { const a = S_[Math.max(0, i - 2)], b = S_[Math.min(m - 1, i + 2)]; hd[i] = Math.atan2(b.x - a.x, b.z - a.z); }
    const measured = pts.some(p => p.lean > 3);
    for (let i = 0; i < m; i++) {
      const a = Math.max(0, i - 6), b = Math.min(m - 1, i + 6);
      let dh = hd[b] - hd[a]; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      const ds = Math.max(1, S_[b].d - S_[a].d), kap = dh / ds; // >0 : le cap augmente
      const vs = S_[i].v / 3.6, phys = Math.atan(vs * vs * Math.abs(kap) / 9.81) / D2R;
      // x = est, z = sud : le cap atan2(dx,dz) diminue dans un virage à droite → kap > 0 = virage à gauche
      let dir = kap > 0 ? 1 : -1;
      if (S_[i].sd === -1) dir = 1; else if (S_[i].sd === 1) dir = -1;
      const mag = measured ? (S_[i].lm > 2 ? Math.min(S_[i].lm, phys * 1.6 + 6) : Math.min(phys, 12)) : phys;
      S_[i].lr = clamp(mag, 0, 58) * (Math.abs(kap) < 0.0006 && !measured ? 0 : dir);
    }
    for (let pass = 0; pass < 3; pass++) for (let i = 1; i < m - 1; i++) S_[i].lr = (S_[i - 1].lr + 2 * S_[i].lr + S_[i + 1].lr) / 4;
    for (let i = 0; i < m; i++) S_[i].hd = hd[i];
    // 6) emprise carte
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    S_.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
    const lng2 = x => ((x + X0) / k / R_EARTH) / D2R, lat2 = z => (2 * Math.atan(Math.exp((-z + Y0) / k / R_EARTH)) - Math.PI / 2) / D2R;
    let gain = 0; for (let i = 1; i < m; i++) if (S_[i].y > S_[i - 1].y) gain += S_[i].y - S_[i - 1].y;
    return { gain: Math.round(gain), S: S_, D: S_[m - 1].d, T: S_[m - 1].t, hasAlt, measured, box: [x0, x1, z0, z1], proj, lng2, lat2, lat0, date: r.d, demo: !!r.demo };
  }

  /* ================= Interface ================= */
  const css = document.createElement('style');
  css.textContent = `
  #r3d{position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;overflow:hidden;z-index:2147482000;background:#05070a;color:#fff;font:15px/1.35 Barlow,Cairo,system-ui,sans-serif;touch-action:none;user-select:none;-webkit-user-select:none}
  #r3d canvas.v{position:absolute;inset:0;width:100%;height:100%;display:block}
  #r3d .top{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:8px;padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px;background:linear-gradient(#000a,#0000)}
  #r3d .top b{flex:1;font:700 18px 'Barlow Condensed',Cairo,sans-serif;letter-spacing:.3px;text-shadow:0 1px 4px #000}
  #r3d .bt{background:#ffffff1f;border:1px solid #ffffff33;color:#fff;border-radius:999px;padding:8px 13px;font:600 14px Barlow,Cairo,sans-serif;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
  #r3d .bt.on{background:var(--acc,#f2b705);color:var(--on-acc,#111);border-color:transparent}
  #r3d .bt:disabled{opacity:.45}
  #r3d .pan{position:absolute;left:0;right:0;bottom:0;padding:10px 12px calc(env(safe-area-inset-bottom,0px) + 12px);background:linear-gradient(#0000,#000c 35%)}
  #r3d .row{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:7px}
  #r3d .row.sc{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}#r3d .row.sc::-webkit-scrollbar{display:none}
  #r3d .row.sc .bt{flex:0 0 auto}
  #r3d input[type=range]{width:100%;accent-color:var(--acc,#f2b705);margin:0}
  #r3d .ab{position:relative;height:30px}
  #r3d .ab input{position:absolute;inset:0;pointer-events:none;background:none;-webkit-appearance:none;appearance:none}
  #r3d .ab input::-webkit-slider-thumb{pointer-events:auto;-webkit-appearance:none;width:26px;height:26px;border-radius:50%;background:var(--acc,#f2b705);border:3px solid #fff;box-shadow:0 1px 6px #000a}
  #r3d .ab input::-moz-range-thumb{pointer-events:auto;width:22px;height:22px;border-radius:50%;background:var(--acc,#f2b705);border:3px solid #fff}
  #r3d .ab .tr{position:absolute;left:12px;right:12px;top:13px;height:4px;border-radius:2px;background:#ffffff33}
  #r3d .ab .sel{position:absolute;top:13px;height:4px;border-radius:2px;background:var(--acc,#f2b705)}
  #r3d .mt{font-size:13px;color:#ffffffc0}
  #r3d .msg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;max-width:86%;font-size:16px;text-shadow:0 1px 4px #000}
  #r3d .rec{color:#ff4d4d;font-weight:700}
  #r3d .out{background:#000c;border:1px solid #ffffff2a;border-radius:14px;padding:10px;margin-top:8px}
  #r3d .out video{width:100%;max-height:38vh;border-radius:10px;background:#000}
  #r3d .x{flex:0 0 auto}
  #r3d::backdrop{background:#000}`;
  document.head.appendChild(css);

  let three = null;
  function loadThree() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (three) return three;
    three = new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'lib/three.min.js'; s.onload = () => ok(window.THREE); s.onerror = () => { three = null; ko(new Error('three')); }; document.head.appendChild(s); });
    return three;
  }

  let V = null; // vue ouverte
  function close() {
    if (!V) return;
    V.alive = false; cancelAnimationFrame(V.raf);
    try { V.rec && V.rec.state !== 'inactive' && V.rec.stop(); } catch (e) {}
    try { V.renderer && V.renderer.dispose(); V.renderer && V.renderer.forceContextLoss && V.renderer.forceContextLoss(); } catch (e) {}
    try { V.outUrl && URL.revokeObjectURL(V.outUrl); } catch (e) {}
    window.removeEventListener('resize', V.onResize);
    try { V.el.open && V.el.close(); } catch (e) {} V.el.remove(); V = null;
    try { window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.KeepAwake && Capacitor.Plugins.KeepAwake.allowSleep(); } catch (e) {}
  }
  window.mrR3dClose = close;

  async function open(ride) {
    close();
    const el = document.createElement('dialog'); el.id = 'r3d';
    el.innerHTML = `<canvas class="v"></canvas><div class="top"><b>🎬 ${W('Revoir mon trajet en 3D', 'إعادة رحلتي ثلاثية الأبعاد', 'Replay my ride in 3D')}</b><button class="bt x" data-k="x">✕</button></div>
      <div class="msg">${W('Préparation de la route en 3D…', 'تجهيز الطريق ثلاثي الأبعاد…', 'Building the 3D road…')}</div>`;
    document.body.appendChild(el);
    try { el.showModal(); } catch (e) { el.setAttribute('open', ''); }
    el.addEventListener('cancel', e => { e.preventDefault(); close(); });
    el.addEventListener('close', () => { if (V && V.el === el) close(); });
    el.querySelector('[data-k=x]').onclick = close;
    V = { el, alive: true };
    const me = V;
    let THREE_;
    try { THREE_ = await loadThree(); } catch (e) { el.querySelector('.msg').textContent = W('Impossible de charger le moteur 3D.', 'تعذّر تحميل محرك ثلاثي الأبعاد.', 'Could not load the 3D engine.'); return; }
    if (!me.alive) return;
    const G = prep(ride);
    if (!G) { el.querySelector('.msg').textContent = W('Tracé trop court pour la 3D.', 'المسار قصير جدًا.', 'Track too short for 3D.'); return; }
    try { build(THREE_, G, ride, me); } catch (e) { console.error(e); el.querySelector('.msg').textContent = W('La 3D n’est pas disponible sur ce téléphone.', 'ثلاثي الأبعاد غير متاح على هذا الهاتف.', '3D is not available on this phone.') + ' (' + (e && e.message || e) + ')'; }
  }

  /* ================= Scène 3D ================= */
  function build(T, G, ride, V) {
    const el = V.el, cv = el.querySelector('canvas.v'), ctx = cv.getContext('2d');
    const S_ = G.S, m = S_.length;
    const acc = (getComputedStyle(document.documentElement).getPropertyValue('--acc') || '#f2b705').trim() || '#f2b705';
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    V.renderer = renderer;
    renderer.outputEncoding = T.sRGBEncoding;
    if (T.ACESFilmicToneMapping) { renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; }
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(55, 1, 0.3, 6000);

    // Ciel + brume
    const skyC = document.createElement('canvas'); skyC.width = 4; skyC.height = 256;
    { const g = skyC.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#2f6fb3'); gr.addColorStop(0.55, '#9cc4e4'); gr.addColorStop(1, '#e9dcc4'); g.fillStyle = gr; g.fillRect(0, 0, 4, 256); }
    const skyT = new T.CanvasTexture(skyC); skyT.encoding = T.sRGBEncoding; scene.background = skyT;
    scene.fog = new T.Fog(0xb7c6d2, 420, 3200);
    scene.add(new T.HemisphereLight(0xdfeeff, 0x4b4230, 0.85));
    const sun = new T.DirectionalLight(0xfff1dc, 1.25); sun.position.set(-300, 500, 200); scene.add(sun);

    // Emprise et relief : le sol suit l'altitude de la route et reste toujours SOUS la route (lacets compris)
    const [bx0, bx1, bz0, bz1] = G.box, pad = Math.max(300, (Math.max(bx1 - bx0, bz1 - bz0)) * 0.18);
    const gx0 = bx0 - pad, gx1 = bx1 + pad, gz0 = bz0 - pad, gz1 = bz1 + pad;
    const step = Math.max(1, Math.floor(m / 400)), near = []; for (let i = 0; i < m; i += step) near.push(S_[i]);
    const meanY = S_.reduce((a, p) => a + p.y, 0) / m;
    const CELL = 25, BK = new Map(), bkey = (i, j) => i * 100003 + j;
    for (let i = 0; i < m; i += 2) { const p = S_[i], k = bkey(Math.floor(p.x / CELL), Math.floor(p.z / CELL)); let a = BK.get(k); if (!a) BK.set(k, a = []); a.push(p); }
    const noise = (x, z) => Math.sin(x * 0.011 + Math.sin(z * 0.007) * 2) * Math.cos(z * 0.013 - Math.sin(x * 0.005)) * 0.6 + Math.sin(x * 0.031 + z * 0.027) * 0.25 + Math.sin(x * 0.07 - z * 0.05) * 0.08;
    const segs = 150, gw = gx1 - gx0, gd = gz1 - gz0, cellG = Math.max(gw, gd) / segs, carveR = Math.max(16, cellG * 1.6);
    const heightAt = (x, z) => {
      const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL), R = Math.ceil(Math.max(80, carveR) / CELL);
      let best = Infinity, hn = 0, cut = Infinity;
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
        const arr = BK.get(bkey(ci + a, cj + b)); if (!arr) continue;
        for (const p of arr) { const dd = (p.x - x) ** 2 + (p.z - z) ** 2; if (dd < best) { best = dd; hn = p.y; } if (dd < carveR * carveR) cut = Math.min(cut, p.y - 0.6 - Math.max(0, Math.sqrt(dd) - 9) * 0.05); }
      }
      let h, dist;
      if (best < Infinity) { dist = Math.sqrt(best); h = hn; }
      else { let w = 0, hs = 0, bd = Infinity; for (const p of near) { const dd = (p.x - x) ** 2 + (p.z - z) ** 2; bd = Math.min(bd, dd); const ww = 1 / (dd + 900); w += ww; hs += ww * p.y; } h = w ? hs / w : meanY; dist = Math.sqrt(bd); }
      const far_ = clamp((dist - 14) / 140, 0, 1);
      h = h - 0.6 + noise(x, z) * (G.hasAlt ? 22 : 7) * far_;
      // bords de la zone : on rejoint doucement l'altitude moyenne
      const ex = Math.min(x - gx0, gx1 - x, z - gz0, gz1 - z), edge = clamp(1 - ex / (pad * 0.8), 0, 1);
      h = h * (1 - edge) + (meanY - 1) * edge;
      return Math.min(h, cut);
    };
    const gGeo = new T.PlaneGeometry(gw, gd, segs, segs); gGeo.rotateX(-Math.PI / 2); gGeo.translate((gx0 + gx1) / 2, 0, (gz0 + gz1) / 2);
    { const pa = gGeo.attributes.position; for (let i = 0; i < pa.count; i++) pa.setY(i, heightAt(pa.getX(i), pa.getZ(i))); gGeo.computeVertexNormals(); }
    // Paysage (par défaut) : herbe, terre et roche
    const land = document.createElement('canvas'); land.width = land.height = 512;
    { const g = land.getContext('2d'); g.fillStyle = '#5f7a3c'; g.fillRect(0, 0, 512, 512);
      const blob = (x, y, r, c, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, c); gr.addColorStop(1, c.slice(0, 7) + '00'); g.globalAlpha = a; g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); };
      for (let i = 0; i < 70; i++) blob(Math.random() * 512, Math.random() * 512, 30 + Math.random() * 90, ['#4c6b2e', '#7a8a46', '#8c7f55', '#6e7f3c', '#94895f'][i % 5], 0.55);
      for (let i = 0; i < 5000; i++) { g.globalAlpha = 0.28; g.fillStyle = ['#3f5a26', '#7d9a4c', '#98a060', '#5a6b34', '#a39a72'][i % 5]; g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 1 + Math.random() * 3); }
      g.globalAlpha = 1; }
    const landT = new T.CanvasTexture(land); landT.wrapS = landT.wrapT = T.RepeatWrapping; landT.repeat.set(gw / 140, gd / 140); landT.encoding = T.sRGBEncoding;
    landT.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const gMat = window.MR3D_DBG ? new T.MeshLambertMaterial({ color: 0x00ff00 }) : new T.MeshLambertMaterial({ map: landT });
    const ground = new T.Mesh(gGeo, gMat); scene.add(ground);
    const landUV = gGeo.attributes.uv.array.slice();
    // plaine lointaine + montagnes autour
    const far = new T.Mesh(new T.PlaneGeometry(16000, 16000), new T.MeshLambertMaterial({ color: window.MR3D_DBG ? 0x0000ff : 0x5f7a3c })); far.rotation.x = -Math.PI / 2; far.position.set((gx0 + gx1) / 2, meanY - 1.2, (gz0 + gz1) / 2); scene.add(far);
    {
      const cx = (gx0 + gx1) / 2, cz = (gz0 + gz1) / 2, rr = Math.max(gw, gd) * 0.5 + 700;
      const hm = new T.MeshLambertMaterial({ color: 0x6d7a62, flatShading: true }), snow = new T.MeshLambertMaterial({ color: 0xf2f4f6, flatShading: true });
      for (let i = 0; i < 30; i++) {
        const a = i / 30 * Math.PI * 2 + Math.random() * 0.15, h = 320 + Math.random() * 700, r = 520 + Math.random() * 700, d = rr + Math.random() * 700;
        const c = new T.Mesh(new T.ConeGeometry(r, h, 8, 1), hm); c.position.set(cx + Math.cos(a) * d, meanY + h / 2 - 5, cz + Math.sin(a) * d); c.rotation.y = Math.random() * 3; scene.add(c);
        if (h > 700) { const sc = new T.Mesh(new T.ConeGeometry(r * 0.28, h * 0.28, 8, 1), snow); sc.position.set(c.position.x, meanY + h * 0.86 - 5, c.position.z); sc.rotation.y = c.rotation.y; scene.add(sc); }
      }
    }
    // Carte OpenStreetMap
    let mapOk = false, mapTex = null, mapUV = null, mapLoading = false, groundMode = 'land';
    function setGround(mode) {
      groundMode = mode; const uv = gGeo.attributes.uv;
      if (mode === 'map' && mapTex) { uv.array.set(mapUV); gMat.map = mapTex; gMat.color.set(0xffffff); mapOk = true; }
      else { uv.array.set(landUV); gMat.map = landT; gMat.color.set(0xffffff); mapOk = false; }
      uv.needsUpdate = true; gMat.needsUpdate = true;
    }
    function loadMap(onDone) {
      if (mapTex) { onDone(true); return; } if (mapLoading) return; mapLoading = true;
      const latN = G.lat2(gz0), latS = G.lat2(gz1), lngW = G.lng2(gx0), lngE = G.lng2(gx1);
      const tx = (lng, z) => (lng + 180) / 360 * 2 ** z, ty = (lat, z) => (1 - Math.log(Math.tan(lat * D2R) + 1 / Math.cos(lat * D2R)) / Math.PI) / 2 * 2 ** z;
      let z = 17, X0, X1, Y0, Y1;
      const maxT = Math.min(renderer.capabilities.maxTextureSize || 4096, 4096);
      for (; z >= 9; z--) { X0 = Math.floor(tx(lngW, z)); X1 = Math.floor(tx(lngE, z)); Y0 = Math.floor(ty(latN, z)); Y1 = Math.floor(ty(latS, z)); const nx = X1 - X0 + 1, ny = Y1 - Y0 + 1; if (nx * ny <= 30 && nx * 256 <= maxT && ny * 256 <= maxT) break; }
      const nx = X1 - X0 + 1, ny = Y1 - Y0 + 1, mc = document.createElement('canvas'); mc.width = nx * 256; mc.height = ny * 256;
      const g = mc.getContext('2d'); g.fillStyle = '#e8e4d8'; g.fillRect(0, 0, mc.width, mc.height);
      let left = nx * ny, okN = 0;
      const tile2lng = (x, z) => x / 2 ** z * 360 - 180, tile2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return Math.atan(Math.sinh(n)) / D2R; };
      const done = () => {
        mapLoading = false;
        if (!V.alive) return;
        if (okN < Math.max(1, (nx * ny) * 0.5)) { onDone(false); return; }
        const tex = new T.CanvasTexture(mc); tex.encoding = T.sRGBEncoding; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        // coordonnées locales des bords de la mosaïque → UV du sol
        const [ax, az] = G.proj(tile2lat(Y0, z), tile2lng(X0, z)), [bx, bz] = G.proj(tile2lat(Y1 + 1, z), tile2lng(X1 + 1, z));
        const pa = gGeo.attributes.position; mapUV = new Float32Array(pa.count * 2);
        for (let i = 0; i < pa.count; i++) { mapUV[i * 2] = (pa.getX(i) - ax) / (bx - ax); mapUV[i * 2 + 1] = 1 - (pa.getZ(i) - az) / (bz - az); }
        tex.wrapS = tex.wrapT = T.ClampToEdgeWrapping; mapTex = tex; onDone(true);
      };
      for (let x = X0; x <= X1; x++) for (let y = Y0; y <= Y1; y++) {
        const im = new Image(); im.crossOrigin = 'anonymous';
        im.onload = () => { g.drawImage(im, (x - X0) * 256, (y - Y0) * 256); okN++; if (--left === 0) done(); };
        im.onerror = () => { if (--left === 0) done(); };
        im.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
      }
    }

    // Route (ruban) + bordures colorées selon l'inclinaison
    const roadC = document.createElement('canvas'); roadC.width = 128; roadC.height = 256;
    { const g = roadC.getContext('2d'); g.fillStyle = '#3a3c40'; g.fillRect(0, 0, 128, 256); for (let i = 0; i < 900; i++) { g.fillStyle = Math.random() < .5 ? '#45474c' : '#303236'; g.fillRect(Math.random() * 128, Math.random() * 256, 1.5, 1.5); }
      g.fillStyle = '#e9e9e2'; g.fillRect(5, 0, 4, 256); g.fillRect(119, 0, 4, 256); g.fillRect(62, 0, 4, 120); }
    const roadT = new T.CanvasTexture(roadC); roadT.wrapT = T.RepeatWrapping; roadT.encoding = T.sRGBEncoding; roadT.anisotropy = 8;
    const W_ = 3.6, KW = 0.7;
    const rp = [], ruv = [], kp = [], kc = [], idx = [], kidx = [];
    const col = a => { a = Math.abs(a); return a < 20 ? [0.18, 0.8, 0.35] : a < 35 ? [0.98, 0.78, 0.12] : [0.95, 0.22, 0.2]; };
    for (let i = 0; i < m; i++) {
      const p = S_[i], nx = Math.cos(p.hd), nz = -Math.sin(p.hd), y = p.y + 0.12; // normale à droite du sens de marche
      rp.push(p.x - nx * W_, y, p.z - nz * W_, p.x + nx * W_, y, p.z + nz * W_);
      ruv.push(0, p.d / 12, 1, p.d / 12);
      const c = col(p.lr);
      kp.push(p.x - nx * (W_ + KW), y - 0.02, p.z - nz * (W_ + KW), p.x - nx * W_, y - 0.01, p.z - nz * W_, p.x + nx * W_, y - 0.01, p.z + nz * W_, p.x + nx * (W_ + KW), y - 0.02, p.z + nz * (W_ + KW));
      for (let j = 0; j < 4; j++) kc.push(...c);
      if (i < m - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); const b = i * 4; kidx.push(b, b + 4, b + 1, b + 1, b + 4, b + 5, b + 2, b + 6, b + 3, b + 3, b + 6, b + 7); }
    }
    const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.Float32BufferAttribute(rp, 3)); rg.setAttribute('uv', new T.Float32BufferAttribute(ruv, 2)); rg.setIndex(idx); rg.computeVertexNormals();
    scene.add(new T.Mesh(rg, new T.MeshLambertMaterial({ map: roadT, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })));
    const kg = new T.BufferGeometry(); kg.setAttribute('position', new T.Float32BufferAttribute(kp, 3)); kg.setAttribute('color', new T.Float32BufferAttribute(kc, 3)); kg.setIndex(kidx); kg.computeVertexNormals();
    scene.add(new T.Mesh(kg, new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 })));
    // talus sous les bords de la route (la route ne « flotte » jamais au-dessus du sol)
    { const sp = [], su = [], si = [], E = W_ + KW, OUT = 7, DN = 6;
      const uvw = (x, z) => su.push((x - gx0) / gw, (gz1 - z) / gd);
      for (let i = 0; i < m; i++) { const p = S_[i], nx = Math.cos(p.hd), nz = -Math.sin(p.hd), y = p.y + 0.1;
        const v = [[p.x - nx * E, y, p.z - nz * E], [p.x - nx * (E + OUT), y - DN, p.z - nz * (E + OUT)], [p.x + nx * E, y, p.z + nz * E], [p.x + nx * (E + OUT), y - DN, p.z + nz * (E + OUT)]];
        v.forEach(q => { sp.push(q[0], q[1], q[2]); uvw(q[0], q[2]); });
        if (i < m - 1) { const a = i * 4; si.push(a, a + 4, a + 1, a + 1, a + 4, a + 5, a + 2, a + 6, a + 3, a + 3, a + 6, a + 7); } }
      const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(sp, 3)); sg.setAttribute('uv', new T.Float32BufferAttribute(su, 2)); sg.setIndex(si); sg.computeVertexNormals();
      scene.add(new T.Mesh(sg, new T.MeshLambertMaterial(window.MR3D_DBG ? { color: 0xff0000, side: T.DoubleSide } : { map: landT, color: 0xcfc6b0, side: T.DoubleSide }))); }
    // Drapeaux départ / arrivée
    const flag = (p, c) => { const g = new T.Group(); const pole = new T.Mesh(new T.CylinderGeometry(.08, .08, 4.5, 6), new T.MeshLambertMaterial({ color: 0xdddddd })); pole.position.y = 2.25; g.add(pole); const f = new T.Mesh(new T.PlaneGeometry(2, 1.2), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide })); f.position.set(1, 3.8, 0); g.add(f); g.position.set(p.x + Math.cos(p.hd) * (W_ + 2), p.y, p.z - Math.sin(p.hd) * (W_ + 2)); scene.add(g); return g; };
    const flagA = flag(S_[0], 0x2ecc71), flagB = flag(S_[m - 1], 0x111111);

    // Arbres (instanciés), jamais sur la route
    {
      const n = 420, trunk = new T.InstancedMesh(new T.CylinderGeometry(.18, .25, 2, 5), new T.MeshLambertMaterial({ color: 0x5b4330 }), n);
      const crown = new T.InstancedMesh(new T.ConeGeometry(1.8, 5.5, 7), new T.MeshLambertMaterial({ color: 0x3f6b35, flatShading: true }), n);
      const o = new T.Object3D(); let c = 0, tries = 0;
      while (c < n && tries < n * 12) {
        tries++;
        const base = near[Math.floor(Math.random() * near.length)], a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 160;
        const x = base.x + Math.cos(a) * r, z = base.z + Math.sin(a) * r;
        if (x < gx0 || x > gx1 || z < gz0 || z > gz1) continue;
        let ok = true; for (const p of near) if ((p.x - x) ** 2 + (p.z - z) ** 2 < 110) { ok = false; break; }
        if (!ok) continue;
        const h = heightAt(x, z), s = 0.7 + Math.random() * 0.8;
        o.position.set(x, h + s, z); o.scale.set(s, s, s); o.rotation.set(0, Math.random() * 3, 0); o.updateMatrix(); trunk.setMatrixAt(c, o.matrix);
        o.position.set(x, h + s * 4.2, z); o.updateMatrix(); crown.setMatrixAt(c, o.matrix); c++;
      }
      trunk.count = crown.count = c; scene.add(trunk, crown);
    }

    // Moto + pilote
    const bike = (function () {
      const root = new T.Group(), body = new T.Group(); root.add(body);
      const M = (c, r, mt) => new T.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });
      const black = M('#121315', .6, .2), chrome = M('#c3c8cf', .25, .9), paint = M(acc, .3, .45), jacket = M('#1d2026', .8, 0), helmet = M(acc, .25, .35), visor = M('#0b0d12', .1, .8);
      const wheels = [];
      const wg = new T.TorusGeometry(.31, .09, 10, 24); wg.rotateY(Math.PI / 2);
      const rim = new T.CylinderGeometry(.22, .22, .06, 12); rim.rotateZ(Math.PI / 2);
      const spokeG = new T.BoxGeometry(.04, .42, .04);
      [.72, -.72].forEach(z => { const w = new T.Group(); w.position.set(0, .4, z); w.add(new T.Mesh(wg, black), new T.Mesh(rim, chrome)); for (let k = 0; k < 3; k++) { const sp = new T.Mesh(spokeG, chrome); sp.rotation.x = k * Math.PI / 3; w.add(sp); } body.add(w); wheels.push(w); });
      const add = (g, mt, x, y, z, rx) => { const o = new T.Mesh(g, mt); o.position.set(x, y, z); if (rx) o.rotation.x = rx; body.add(o); return o; };
      const sc = (g, mt, x, y, z, sx, sy, sz, rx) => { const o = add(g, mt, x, y, z, rx); o.scale.set(sx, sy, sz); return o; };
      // moto type roadster : bloc moteur, réservoir galbé, selle, coque arrière, phare rond
      add(new T.BoxGeometry(.3, .32, .62), black, 0, .55, .02);
      add(new T.CylinderGeometry(.16, .16, .34, 14), M('#2a2c30', .4, .7), 0, .5, .12).rotation.z = Math.PI / 2;
      sc(new T.SphereGeometry(.3, 20, 14), paint, 0, .9, .22, .78, .62, 1.12);
      sc(new T.SphereGeometry(.2, 16, 10), black, 0, .87, -.22, .78, .32, 1.35);
      sc(new T.ConeGeometry(.17, .55, 12), paint, 0, .95, -.62, 1, 1, .55, -Math.PI / 2 + .18);
      add(new T.CylinderGeometry(.035, .035, .78, 8), chrome, .11, .74, .6, -.42);
      add(new T.CylinderGeometry(.035, .035, .78, 8), chrome, -.11, .74, .6, -.42);
      const hl = add(new T.CylinderGeometry(.11, .1, .1, 18), M('#ffffff', .2, .3), 0, 1.02, .8, Math.PI / 2 - .25);
      hl.material.emissive = new T.Color('#fff4d0'); hl.material.emissiveIntensity = .9;
      add(new T.CylinderGeometry(.13, .12, .08, 18), black, 0, 1.03, .76, Math.PI / 2 - .25);
      add(new T.CylinderGeometry(.045, .07, .55, 10), chrome, .17, .48, -.5, Math.PI / 2.3);
      add(new T.BoxGeometry(.66, .035, .035), black, 0, 1.12, .52);
      [-1, 1].forEach(k => { add(new T.CylinderGeometry(.01, .01, .2, 4), black, .3 * k, 1.2, .5); sc(new T.SphereGeometry(.045, 8, 6), black, .3 * k, 1.3, .5, 1.3, .7, .4); });
      // pilote penché vers l'avant (blouson sombre, liseré aux couleurs du thème)
      add(new T.CylinderGeometry(.19, .23, .6, 14), jacket, 0, 1.33, -.05, .7);
      add(new T.CylinderGeometry(.235, .235, .07, 14), paint, 0, 1.2, -.13, .7);
      add(new T.BoxGeometry(.42, .22, .54), M('#26292f', .8, 0), 0, 1.02, -.18);
      const arm = new T.CylinderGeometry(.055, .06, .56, 8); add(arm, jacket, .22, 1.3, .3, Math.PI / 2 - .45); add(arm, jacket, -.22, 1.3, .3, Math.PI / 2 - .45);
      const leg = new T.CylinderGeometry(.07, .075, .55, 8); add(leg, M('#26292f', .8, 0), .23, .82, .05, Math.PI / 2 + .6); add(leg, M('#26292f', .8, 0), -.23, .82, .05, Math.PI / 2 + .6);
      [-1, 1].forEach(k => add(new T.BoxGeometry(.1, .1, .22), black, .24 * k, .62, -.12));
      const head = new T.Mesh(new T.SphereGeometry(.17, 16, 12), helmet); head.position.set(0, 1.66, .2); body.add(head);
      const vs = new T.Mesh(new T.SphereGeometry(.173, 16, 8, -1.1, 2.2, 1.2, .7), visor); vs.position.copy(head.position); body.add(vs);
      const lampC = document.createElement('canvas'); lampC.width = lampC.height = 64; { const g = lampC.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, '#fff'); r.addColorStop(.3, '#fff7d0'); r.addColorStop(1, '#fff0'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }
      const lamp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(lampC), blending: T.AdditiveBlending, depthWrite: false, transparent: true })); lamp.position.set(0, 1.05, .86); lamp.scale.set(.9, .9, 1); body.add(lamp);
      const tail = new T.Sprite(new T.SpriteMaterial({ color: 0xff2a1a, map: lamp.material.map, blending: T.AdditiveBlending, depthWrite: false, transparent: true })); tail.position.set(0, .98, -.8); tail.scale.set(.45, .45, 1); body.add(tail);
      const shC = document.createElement('canvas'); shC.width = shC.height = 64; { const g = shC.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, '#000b'); r.addColorStop(1, '#0000'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); }
      const sh = new T.Mesh(new T.PlaneGeometry(1.5, 2.8), new T.MeshBasicMaterial({ map: new T.CanvasTexture(shC), transparent: true, depthWrite: false })); sh.rotation.x = -Math.PI / 2; sh.position.y = .02; root.add(sh);
      root.scale.setScalar(1.15);
      scene.add(root); return { root, body, wheels, sh };
    })();

    /* ---------- État de lecture ---------- */
    const st = { a: 0, b: 1, t: 0, playing: true, speed: 'auto', cam: '360', camT: 0, orbit: 0, last: performance.now(), recording: false };
    const segT = () => (S_[idxAtFrac(st.b)].t - S_[idxAtFrac(st.a)].t);
    const idxAtFrac = f => clamp(Math.round(f * (m - 1)), 0, m - 1);
    const mult = () => st.speed === 'auto' ? Math.max(1, segT() / 45) : +st.speed;
    st.t = S_[0].t;
    function sampleAt(t) {
      let lo = 0, hi = m - 1; if (t <= S_[0].t) return { i: 0, f: 0 }; if (t >= S_[hi].t) return { i: hi - 1, f: 1 };
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (S_[mid].t <= t) lo = mid; else hi = mid; }
      return { i: lo, f: (t - S_[lo].t) / Math.max(1e-6, S_[hi].t - S_[lo].t) };
    }
    const lerpA = (a, b, f) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * f; };
    const cur = { x: 0, y: 0, z: 0, hd: 0, lr: 0, v: 0, d: 0, grade: 0 };
    const camPos = new T.Vector3(), camLook = new T.Vector3(); let camInit = false;

    /* ---------- Panneau de commandes ---------- */
    const pan = document.createElement('div'); pan.className = 'pan';
    const speeds = [['auto', W('Auto ≈45 s', 'تلقائي ≈45 ث', 'Auto ≈45 s')], ['1', '×1'], ['5', '×5'], ['10', '×10'], ['30', '×30']];
    const cams = [['360', '🔄 360°'], ['chase', W('🏍 Poursuite', '🏍 مطاردة', '🏍 Chase')], ['drone', '🚁 Drone'], ['side', W('↔ Côté', '↔ جانب', '↔ Side')], ['cine', W('🎞 Cinéma', '🎞 سينما', '🎞 Cinema')]];
    pan.innerHTML = `
      <input type="range" class="tl" min="0" max="1000" value="0" aria-label="position">
      <div class="row"><button class="bt" data-k="play">⏸</button><span class="mt tm"></span><span style="flex:1"></span><button class="bt" data-k="ab">✂️ A → B</button><button class="bt" data-k="rec">⏺ ${W('Vidéo', 'فيديو', 'Video')}</button></div>
      <div class="abw" hidden><div class="mt">${W('Choisis le départ A et l’arrivée B du film :', 'اختر البداية A والنهاية B:', 'Pick start A and end B:')} <b class="abt"></b></div>
        <div class="ab"><div class="tr"></div><div class="sel"></div><input type="range" class="ra" min="0" max="1000" value="0" aria-label="A"><input type="range" class="rb" min="0" max="1000" value="1000" aria-label="B"></div></div>
      <div class="row sc">${cams.map(([k, l]) => `<button class="bt${k === st.cam ? ' on' : ''}" data-cam="${k}">${l}</button>`).join('')}</div>
      <div class="row sc"><button class="bt" data-k="gnd">🗺 ${W('Carte', 'الخريطة', 'Map')}</button>${speeds.map(([k, l]) => `<button class="bt${k === st.speed ? ' on' : ''}" data-sp="${k}">${l}</button>`).join('')}</div>
      <div class="outw"></div>`;
    el.appendChild(pan);
    let basePan = 190; requestAnimationFrame(() => { basePan = pan.offsetHeight || 190; });
    el.querySelector('.msg').remove();
    const $p = s => pan.querySelector(s);
    const tl = $p('.tl'), ra = $p('.ra'), rb = $p('.rb');
    const setActive = (attr, val) => pan.querySelectorAll(`[data-${attr}]`).forEach(b => b.classList.toggle('on', b.dataset[attr] === val));
    function abUi() {
      const a = +ra.value / 1000, b = +rb.value / 1000, w = ra.getBoundingClientRect().width - 24;
      const sel = $p('.sel'); sel.style.left = (12 + a * w) + 'px'; sel.style.width = Math.max(0, (b - a) * w) + 'px';
      const ia = idxAtFrac(a), ib = idxAtFrac(b), km = (S_[ib].d - S_[ia].d) / 1000;
      $p('.abt').textContent = `${km.toFixed(1)} km · ${fmt(S_[ib].t - S_[ia].t)} → ${W('film', 'فيلم', 'film')} ${fmt((S_[ib].t - S_[ia].t) / mult())}`;
    }
    ra.oninput = () => { if (+ra.value > +rb.value - 20) ra.value = +rb.value - 20; st.a = +ra.value / 1000; st.t = S_[idxAtFrac(st.a)].t; abUi(); };
    rb.oninput = () => { if (+rb.value < +ra.value + 20) rb.value = +ra.value + 20; st.b = +rb.value / 1000; if (st.t > S_[idxAtFrac(st.b)].t) st.t = S_[idxAtFrac(st.a)].t; abUi(); };
    tl.oninput = () => { st.t = S_[0].t + (S_[m - 1].t - S_[0].t) * (+tl.value / 1000); const ta = S_[idxAtFrac(st.a)].t, tb = S_[idxAtFrac(st.b)].t; st.t = clamp(st.t, ta, tb); };
    pan.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cam) { st.cam = b.dataset.cam; st.camT = 0; setActive('cam', st.cam); }
      else if (b.dataset.sp) { st.speed = b.dataset.sp; setActive('sp', st.speed); abUi(); }
      else if (b.dataset.k === 'play') { st.playing = !st.playing; if (st.playing && st.t >= S_[idxAtFrac(st.b)].t - 0.01) st.t = S_[idxAtFrac(st.a)].t; b.textContent = st.playing ? '⏸' : '▶'; }
      else if (b.dataset.k === 'ab') { const w = $p('.abw'); w.hidden = !w.hidden; abUi(); }
      else if (b.dataset.k === 'rec') record();
      else if (b.dataset.k === 'gnd') {
        if (groundMode === 'map') { setGround('land'); b.classList.remove('on'); return; }
        b.disabled = true; b.textContent = '⏳ ' + W('Carte…', 'الخريطة…', 'Map…');
        loadMap(ok => { b.disabled = false; b.textContent = '🗺 ' + W('Carte', 'الخريطة', 'Map'); if (ok) { setGround('map'); b.classList.add('on'); } else alert(W('Carte indisponible (pas de réseau ?). Le paysage reste affiché.', 'الخريطة غير متاحة.', 'Map unavailable (no network?).')); });
      }
    });
    abUi();

    /* ---------- Enregistrement vidéo ---------- */
    function record() {
      if (st.recording) { stopRec(); return; }
      const mt = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
      if (!mt || !cv.captureStream) { alert(W('Ce téléphone ne permet pas d’enregistrer la vidéo.', 'هذا الهاتف لا يدعم تسجيل الفيديو.', 'This phone cannot record video.')); return; }
      const stream = cv.captureStream(30), chunks = [];
      const rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: 6e6 });
      rec.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        st.recording = false; recBtn.textContent = '⏺ ' + W('Vidéo', 'فيديو', 'Video'); recBtn.classList.remove('on');
        if (!V.alive || !chunks.length) return;
        const blob = new Blob(chunks, { type: mt.split(';')[0] }), ext = mt.includes('mp4') ? 'mp4' : 'webm';
        try { V.outUrl && URL.revokeObjectURL(V.outUrl); } catch (e) {}
        V.outUrl = URL.createObjectURL(blob); V.outBlob = blob; V.outExt = ext;
        $p('.outw').innerHTML = `<div class="out"><video src="${V.outUrl}" controls playsinline></video><div class="row"><button class="bt on" data-k="save">📤 ${W('Partager / enregistrer', 'مشاركة / حفظ', 'Share / save')}</button><a class="bt" href="${V.outUrl}" download="motoroute-trajet-3d.${ext}" style="text-decoration:none">⬇ ${W('Télécharger', 'تنزيل', 'Download')}</a><button class="bt" data-k="outx">✕</button></div></div>`;
        $p('[data-k=save]').onclick = () => saveVideo(blob, ext);
        $p('[data-k=outx]').onclick = () => { $p('.outw').innerHTML = ''; };
      };
      st.t = S_[idxAtFrac(st.a)].t; st.playing = true; pan.querySelector('[data-k=play]').textContent = '⏸'; camInit = false; st.orbit = 0; st.camT = 0;
      st.recording = true; V.rec = rec; rec.start(500);
      recBtn.textContent = '⏹ ' + W('Arrêter', 'إيقاف', 'Stop'); recBtn.classList.add('on');
      $p('.outw').innerHTML = '';
    }
    function stopRec() { try { V.rec && V.rec.state !== 'inactive' && V.rec.stop(); } catch (e) {} }
    const recBtn = $p('[data-k=rec]');

    /* ---------- Rendu ---------- */
    let dpr = 1, Wd = 1, Ht = 1;
    function resize() {
      dpr = Math.min(1.5, window.devicePixelRatio || 1); Wd = Math.max(2, Math.round(el.clientWidth * dpr)); Ht = Math.max(2, Math.round(el.clientHeight * dpr));
      cv.width = Wd; cv.height = Ht; renderer.setPixelRatio(1); renderer.setSize(Wd, Ht, false); camera.aspect = Wd / Ht; camera.updateProjectionMatrix();
    }
    V.onResize = () => setTimeout(resize, 120); window.addEventListener('resize', V.onResize); resize();
    try { window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.KeepAwake && Capacitor.Plugins.KeepAwake.keepAwake(); } catch (e) {}

    // mini-carte (tracé complet)
    const mm = document.createElement('canvas'), MM = 220; mm.width = mm.height = MM;
    { const g = mm.getContext('2d'), sx = bx1 - bx0 || 1, sz = bz1 - bz0 || 1, sc = (MM - 24) / Math.max(sx, sz);
      V.mmP = (x, z) => [12 + (x - bx0) * sc + ((MM - 24) - sx * sc) / 2, 12 + (z - bz0) * sc + ((MM - 24) - sz * sc) / 2];
      g.lineWidth = 5; g.lineJoin = g.lineCap = 'round';
      for (let i = 1; i < m; i += Math.max(1, Math.floor(m / 600))) { const a = V.mmP(S_[Math.max(0, i - Math.max(1, Math.floor(m / 600)))].x, S_[Math.max(0, i - Math.max(1, Math.floor(m / 600)))].z), b = V.mmP(S_[i].x, S_[i].z); const c = col(S_[i].lr); g.strokeStyle = `rgb(${c.map(v => Math.round(v * 255)).join(',')})`; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } }
    const who = (() => { try { const u = window.mrUser && window.mrUser(); return (u && u.user_metadata && u.user_metadata.first_name) || (S.me && S.me.name) || ''; } catch (e) { return ''; } })();
    const dateTxt = (() => { try { return new Date(G.date + 'T12:00:00').toLocaleDateString(L() === 'ar' ? 'ar-DZ' : L() === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return G.date || ''; } })();

    function hud() {
      const s = Ht / 900 * 1.0 + 0.45, g = ctx; g.save();
      const pad = 18 * s;
      // titre
      g.font = `700 ${22 * s}px 'Barlow Condensed',Cairo,sans-serif`; g.fillStyle = '#fff'; g.shadowColor = '#000'; g.shadowBlur = 6 * s;
      g.textAlign = 'left'; g.fillText('MOTOROUTE' + (who ? ' · ' + who : ''), pad, Ht * 0.12 + 10 * s);
      g.font = `500 ${15 * s}px Barlow,Cairo,sans-serif`; g.fillStyle = '#ffffffd0';
      g.fillText(G.demo ? W('Démo – col de montagne', 'عرض – ممر جبلي', 'Demo – mountain pass') : dateTxt, pad, Ht * 0.12 + 32 * s);
      g.fillText((G.D / 1000).toFixed(1) + ' km' + (G.hasAlt ? ' · D+ ' + G.gain + ' m' : ''), pad, Ht * 0.12 + 52 * s);
      // mini-carte
      const ms = Math.min(Wd, Ht) * 0.26, mx = Wd - ms - pad, my = Ht * 0.12 - 8 * s;
      g.shadowBlur = 0; g.fillStyle = '#0008'; g.beginPath(); g.roundRect ? g.roundRect(mx, my, ms, ms, 12 * s) : g.rect(mx, my, ms, ms); g.fill();
      g.drawImage(mm, mx, my, ms, ms);
      const pa = V.mmP(S_[idxAtFrac(st.a)].x, S_[idxAtFrac(st.a)].z), pb = V.mmP(S_[idxAtFrac(st.b)].x, S_[idxAtFrac(st.b)].z), pc = V.mmP(cur.x, cur.z), k = ms / MM;
      [[pa, '#2ecc71', 'A'], [pb, '#ffffff', 'B']].forEach(([p, c, t]) => { g.fillStyle = c; g.beginPath(); g.arc(mx + p[0] * k, my + p[1] * k, 5 * s, 0, 7); g.fill(); g.fillStyle = '#000'; g.font = `700 ${8 * s}px sans-serif`; g.textAlign = 'center'; g.fillText(t, mx + p[0] * k, my + p[1] * k + 3 * s); });
      g.fillStyle = acc; g.strokeStyle = '#fff'; g.lineWidth = 2 * s; g.beginPath(); g.arc(mx + pc[0] * k, my + pc[1] * k, 6 * s, 0, 7); g.fill(); g.stroke();
      // compteur vitesse + inclinaison (bas gauche, au-dessus du panneau)
      const by = Ht - (basePan * dpr) - 16 * s, cx = pad + 70 * s, cy = by - 70 * s;
      g.fillStyle = '#000a'; g.beginPath(); g.arc(cx, cy, 68 * s, 0, 7); g.fill();
      const la = clamp(cur.lr, -60, 60) * D2R, lc = col(cur.lr).map(v => Math.round(v * 255)).join(',');
      g.strokeStyle = '#ffffff30'; g.lineWidth = 6 * s; g.beginPath(); g.arc(cx, cy, 58 * s, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
      g.strokeStyle = `rgb(${lc})`; g.beginPath(); const mid = Math.PI * 1.5; g.arc(cx, cy, 58 * s, Math.min(mid, mid - la), Math.max(mid, mid - la)); g.stroke();
      g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `800 ${40 * s}px 'Barlow Condensed',sans-serif`; g.fillText(Math.round(cur.v), cx, cy + 10 * s);
      g.font = `600 ${12 * s}px Barlow,sans-serif`; g.fillStyle = '#ffffffb0'; g.fillText('km/h', cx, cy + 26 * s);
      const ab = Math.round(Math.abs(cur.lr));
      g.font = `700 ${17 * s}px Barlow,sans-serif`; g.fillStyle = `rgb(${lc})`; g.fillText(ab < 3 ? '↑ 0°' : (cur.lr > 0 ? '↶ ' : '↷ ') + ab + '°', cx, cy + 50 * s);
      // temps / distance
      g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `600 ${16 * s}px Barlow,sans-serif`;
      g.fillText(`⏱ ${fmt(st.t - S_[0].t)} / ${fmt(G.T - S_[0].t)}`, cx + 80 * s, cy - 6 * s);
      g.fillText(`📍 ${(cur.d / 1000).toFixed(2)} / ${(G.D / 1000).toFixed(1)} km`, cx + 80 * s, cy + 18 * s);
      if (mult() > 1.01) { g.fillStyle = '#ffffffa0'; g.font = `600 ${13 * s}px Barlow,sans-serif`; g.fillText(`▶▶ ×${mult() < 10 ? mult().toFixed(1) : Math.round(mult())}`, cx + 80 * s, cy + 40 * s); }
      if (st.recording) { g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(Wd - pad - 6 * s, my + ms + 22 * s, 7 * s, 0, 7); g.fill(); g.textAlign = 'right'; g.font = `700 ${14 * s}px Barlow,sans-serif`; g.fillText('REC', Wd - pad - 18 * s, my + ms + 27 * s); }
      g.textAlign = 'right'; g.fillStyle = '#ffffffb0'; g.font = `500 ${11 * s}px Barlow,sans-serif`; g.fillText((mapOk ? '© OpenStreetMap · ' : '') + 'MotoRoute', Wd - pad, by - 4 * s);
      g.restore();
    }

    function frame(now) {
      if (!V.alive) return;
      V.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - st.last) / 1000); st.last = now;
      const ta = S_[idxAtFrac(st.a)].t, tb = S_[idxAtFrac(st.b)].t;
      if (st.playing) {
        st.t += dt * mult();
        if (st.t >= tb) { st.t = tb; if (st.recording) { stopRec(); st.playing = false; pan.querySelector('[data-k=play]').textContent = '▶'; } else { st.t = ta; camInit = false; } }
      }
      if (document.activeElement !== tl) tl.value = Math.round((st.t - S_[0].t) / Math.max(1e-6, S_[m - 1].t - S_[0].t) * 1000);
      pan.querySelector('.tm').textContent = `${fmt(st.t - S_[0].t)} / ${fmt(G.T - S_[0].t)}`;
      // position interpolée
      const { i, f } = sampleAt(st.t), A = S_[i], B = S_[Math.min(m - 1, i + 1)];
      cur.x = A.x + (B.x - A.x) * f; cur.y = A.y + (B.y - A.y) * f; cur.z = A.z + (B.z - A.z) * f;
      cur.hd = lerpA(A.hd, B.hd, f); cur.lr = A.lr + (B.lr - A.lr) * f; cur.v = A.v + (B.v - A.v) * f; cur.d = A.d + (B.d - A.d) * f;
      const j = Math.min(m - 1, i + 8), k0 = Math.max(0, i - 8); cur.grade = Math.atan2(S_[j].y - S_[k0].y, Math.max(1, S_[j].d - S_[k0].d));
      bike.root.position.set(cur.x, cur.y + 0.12, cur.z); bike.root.rotation.set(0, cur.hd, 0);
      bike.body.rotation.set(-cur.grade, 0, 0); bike.body.rotation.z = -cur.lr * D2R; // + = penché à gauche
      const spin = (cur.v / 3.6) * dt / 0.4 * (st.playing ? mult() : 0); bike.wheels.forEach(w => w.rotation.x += spin);
      bike.sh.position.x = Math.sin(cur.lr * D2R) * 0.5;
      // caméra
      st.camT += dt; let mode = st.cam;
      if (mode === 'cine') mode = ['360', 'chase', 'side', 'drone', '360', 'front'][Math.floor(st.camT / 7) % 6];
      const fx = Math.sin(cur.hd), fz = Math.cos(cur.hd), rx = Math.cos(cur.hd), rz = -Math.sin(cur.hd);
      const P = new T.Vector3(), Lk = new T.Vector3(cur.x, cur.y + 1.1, cur.z);
      if (mode === '360') { st.orbit += dt * 0.42; const a = cur.hd + Math.PI + st.orbit; P.set(cur.x + Math.sin(a) * 8.5, cur.y + 2.6 + Math.sin(st.orbit * 0.7) * 0.7, cur.z + Math.cos(a) * 8.5); Lk.y = cur.y + 0.35; }
      else if (mode === 'chase') P.set(cur.x - fx * 7.5, cur.y + 2.9, cur.z - fz * 7.5);
      else if (mode === 'drone') { P.set(cur.x - fx * 22 + rx * 8, cur.y + 34, cur.z - fz * 22 + rz * 8); Lk.add(new T.Vector3(fx * 10, 0, fz * 10)); }
      else if (mode === 'side') P.set(cur.x + rx * 6.5 + fx * 1.5, cur.y + 1.3, cur.z + rz * 6.5 + fz * 1.5);
      else if (mode === 'front') { P.set(cur.x + fx * 8 - rx * 2, cur.y + 1.4, cur.z + fz * 8 - rz * 2); }
      // lissage dans le repère du pilote (la caméra ne « décroche » jamais, même en ×30)
      const B0 = new T.Vector3(cur.x, cur.y, cur.z), off = P.clone().sub(B0), lo = Lk.clone().sub(B0);
      if (!camInit || st.camMode !== mode) { if (!camInit) { camPos.copy(off); camLook.copy(lo); } camInit = true; st.camMode = mode; }
      camPos.lerp(off, 1 - Math.exp(-dt * (mode === '360' ? 12 : 3.5))); camLook.lerp(lo, 1 - Math.exp(-dt * 8));
      const C = B0.clone().add(camPos), gh = Math.max(heightAt(C.x, C.z), cur.y) + 0.9; if (C.y < gh) C.y = gh;
      camera.position.copy(C); camera.lookAt(B0.clone().add(camLook));
      sun.position.set(cur.x - 300, cur.y + 500, cur.z + 200); sun.target.position.set(cur.x, cur.y, cur.z); sun.target.updateMatrixWorld();
      renderer.render(scene, camera);
      ctx.drawImage(renderer.domElement, 0, 0, Wd, Ht);
      hud();
    }
    V.raf = requestAnimationFrame(t => { st.last = t; frame(t); });
  }

  /* ================= Partage de la vidéo ================= */
  async function saveVideo(blob, ext) {
    const name = 'motoroute-trajet-3d-' + Date.now() + '.' + ext;
    const P = window.Capacitor && Capacitor.Plugins;
    if (P && P.Filesystem && P.Share) {
      try {
        const b64 = await new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(blob); });
        const w = await P.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' });
        await P.Share.share({ title: 'MotoRoute', text: W('Mon trajet en 3D sur MotoRoute', 'رحلتي ثلاثية الأبعاد على MotoRoute', 'My ride in 3D on MotoRoute'), files: [w.uri], dialogTitle: W('Partager la vidéo', 'مشاركة الفيديو', 'Share the video') });
        return;
      } catch (e) { if (e && /cancel/i.test(e.message || '')) return; }
    }
    try {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'MotoRoute' }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  /* ================= Points d'entrée ================= */
  window.mrR3dOpen = id => { const r = id === 'demo' ? demoRide() : rides().find(x => String(x.id) === String(id)); if (r && (r.demo || hasTrack(r))) open(r); else alert(W('Ce trajet n’a pas de tracé GPS (enregistré avant la version test-28).', 'هذه الرحلة بدون مسار GPS.', 'This ride has no GPS track.')); };
  window.mrR3dBtn = (r, big) => hasTrack(r) ? (big ? ` <button class="g" data-r3d="${ESC(r.id)}">🎬 ${W('Revoir en 3D', 'إعادة 3D', 'Replay 3D')}</button>` : ` <button class="g" data-r3d="${ESC(r.id)}" style="padding:4px 10px;font-size:13px;margin-inline-start:6px">🎬 3D</button>`) : '';
  if (typeof window.mrCmpBtn === 'function') { const o = window.mrCmpBtn; window.mrCmpBtn = (r, big) => o(r, big) + window.mrR3dBtn(r, big); }
  function card() {
    const L_ = rides().filter(hasTrack).slice(0, 5);
    return `<div class="card"><h3>🎬 ${W('Revoir mon trajet en 3D', 'إعادة رحلتي ثلاثية الأبعاد', 'Replay my ride in 3D')}</h3>
      <div class="meta">${W('Ta route reconstruite en 3D sur la carte, avec ta vraie vitesse et ta vraie inclinaison. Caméra 360° autour de toi, choix du tronçon A → B et film à partager.', 'طريقك ثلاثي الأبعاد على الخريطة بسرعتك وميلانك الحقيقيين، كاميرا 360°، اختيار المقطع A → B وفيلم للمشاركة.', 'Your road rebuilt in 3D on the map with your real speed and lean. 360° camera, A → B section and a film to share.')}</div>
      ${L_.length ? L_.map(r => `<div class="row" style="justify-content:space-between;margin-top:8px"><span class="meta">${ESC(r.d)} · ${r.km} km · ${fmt(r.dur || 0)}</span><button class="g" data-r3d="${ESC(r.id)}">🎬 ${W('Revoir', 'إعادة', 'Replay')}</button></div>`).join('')
        : `<div class="meta" style="margin-top:6px">${W('Aucun trajet avec tracé pour l’instant : fais un trajet avec Démarrer → Arrêter.', 'لا توجد رحلة بمسار بعد.', 'No ride with a track yet: record one with Start → Stop.')}</div>`}
      <div class="row" style="margin-top:8px"><button class="g" data-r3d="demo">👀 ${W('Voir une démo', 'عرض تجريبي', 'See a demo')}</button></div></div>`;
  }
  if (typeof window.mrRideView === 'function') {
    const o = window.mrRideView;
    window.mrRideView = function (t) { const h = o(t); return /data-rdstart/.test(h) ? h + card() : h; };
  }
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-r3d]'); if (!b) return; e.preventDefault(); window.mrR3dOpen(b.dataset.r3d); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && V) close(); });
  window.addEventListener('popstate', () => { if (V) close(); });
})();
