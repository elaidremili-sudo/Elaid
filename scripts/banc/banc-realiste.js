// Banc d'essai RÉALISTE (test-71) : comme banc-inclinaison.js, plus le retard de la vitesse GPS, le freinage avant les virages,
// le pilote penché vers l'intérieur (la moto penche moins que l'angle d'équilibre) et la mesure de l'ANGLE MAXIMUM de chaque virage
// (celui qu'affiche le tableau de bord d'une moto à centrale inertielle, comme la Z H2 d'Elaid).
// Banc d'essai de l'inclinaison MotoRoute : trajets simulés (physique moto/voiture), capteurs du téléphone
// (accéléromètre + gyroscope échantillonnés comme dans un navigateur Android, vibrations du support, GPS 1 Hz bruité).
// Usage : node scripts/banc/banc-inclinaison.js [module, par défaut www/js/lean.js] [graine]
const path = require('path');
const MOD = require(path.resolve(process.argv[2] || path.join(__dirname, '../../www/js/lean.js')));
const SEED = +(process.argv[3] || 1);
let s = SEED >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 };
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) };
const D = Math.PI / 180, G = 9.81;

// ---------- algèbre ----------
const mul = (A, v) => [A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2], A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2], A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]];
const T = A => [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
const mm = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const Rx = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Ry = a => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rz = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = v => { const m = Math.hypot(...v); return v.map(x => x / m) };
// support : colonnes = axes du téléphone exprimés dans le repère moto (x avant, y gauche, z haut)
function mount(kind) {
  let xP, yP;
  if (kind === 'portrait') { xP = [0, -1, 0]; yP = unit([-Math.sin(20 * D), 0, Math.cos(20 * D)]) }
  else if (kind === 'paysage') { xP = unit([-Math.sin(15 * D), 0, Math.cos(15 * D)]); yP = [0, 1, 0] }
  else if (kind === 'penche') { xP = unit([0.15, -1, 0.2]); yP = unit(cross(cross(xP, [-0.5, 0.1, 1]), xP)).map(x => -x); yP = unit([-0.5, 0.1, 1]); yP = unit(yP.map((v, i) => v - (yP[0] * xP[0] + yP[1] * xP[1] + yP[2] * xP[2]) * xP[i])) }
  const zP = cross(xP, yP);
  return [[xP[0], yP[0], zP[0]], [xP[1], yP[1], zP[1]], [xP[2], yP[2], zP[2]]]; // R_BP
}

// ---------- parcours : segments [durée s, vitesse km/h début→fin, rayon m (+ gauche / - droite / 0 droit)] ----------
const ROUTES = {
  moto: [[3, 0, 0], [10, [0, 90], 0], [35, 120, 0], [6, [120, 70], 0], [9, 70, 80], [12, 75, 0], [8, 55, -40], [10, 60, 0], [7, 45, 25], [4, 40, 0], [7, 45, -25], [15, 80, 0], [10, 90, 150], [10, 90, -150], [20, 100, 0], [5, 30, 15], [3, 30, 0], [5, 30, -15], [20, 90, 0], [8, [90, 0], 0], [3, 0, 0]],
  route: [[3, 0, 0], [10, [0, 100], 0], [20, 100, 0], [4, [100, 60], 0], [7, 60, 45], [4, [60, 95], 0], [8, 95, 0], [4, [95, 50], 0], [6, 50, -30], [4, [50, 85], 0], [3, [85, 65], 0], [8, 65, 70], [3, 65, 0], [8, 70, -60], [5, [70, 100], 0], [10, 100, 0], [4, [100, 55], 0], [7, 55, 38], [4, [55, 90], 0], [15, 90, 0], [6, [90, 0], 0], [3, 0, 0]],
  voiture: [[3, 0, 0], [10, [0, 110], 0], [60, 127, 0], [20, 127, 800], [20, 127, 0], [8, 50, 30], [20, 90, 0], [6, [90, 0], 0], [3, 0, 0]],
};

function simulate(cfg) {
  const fs = cfg.fs || 60, dt = 1 / fs, Rbp = mount(cfg.mount || 'portrait'), Rpb = T(Rbp);
  const segs = ROUTES[cfg.route || 'moto'];
  const est = MOD.create(Object.assign({ U: unit(mul(Rpb, [0, 0, G])), sens: cfg.sens, debug: true }, JSON.parse(process.env.BANC_OPT || '{}'))); if (est.start) est.start();
  let t = 0, psi = 0, X = 0, Y = 0, phiPrev = 0, wPrev = 0, gpsT = 0, gx = 0, gy = 0;
  const out = []; const ph = [0, 1, 2, 3, 4, 5].map(() => rnd() * 6.28);
  const V = cfg.vib || {}; const t0 = 1.7e12;
  let segI = 0, segT = 0, wSm = 0; const vH = [];
  while (segI < segs.length) {
    const [dur, sp, rad] = segs[segI];
    const f = segT / dur, vk = Array.isArray(sp) ? sp[0] + (sp[1] - sp[0]) * f : sp, v = vk / 3.6;
    const vNext = Array.isArray(sp) ? (sp[1] - sp[0]) / 3.6 / dur : 0;
    const wTarget = rad ? v / rad : 0;
    // transition douce du lacet (entrée/sortie de virage en ~1,2 s)
    wSm += (wTarget - wSm) * Math.min(1, dt / 0.4);
    const w = wSm;
    const car = cfg.route === 'voiture';
    const phiTrue = Math.atan(v * w / G); // > 0 : penché à gauche
    const phiBike = car ? 0 : phiTrue * (cfg.bike || 1); // cfg.bike < 1 : pilote penché vers l'intérieur, la moto penche moins
    const phiRate = (phiBike - phiPrev) / dt; phiPrev = phiBike;
    psi += w * dt; X += v * Math.cos(psi) * dt; Y += v * Math.sin(psi) * dt;
    // repère moto dans le monde (x avant, y gauche, z haut) : lacet puis roulis (gauche = rotation négative autour de x avant)
    const Rwb = mm(Rz(psi), Rx(-phiBike));
    const aW = [vNext * Math.cos(psi) - v * w * Math.sin(psi), vNext * Math.sin(psi) + v * w * Math.cos(psi), 0];
    const fW = [aW[0], aW[1], aW[2] + G];
    let fB = mul(T(Rwb), fW);
    const xB = [Rwb[0][0], Rwb[1][0], Rwb[2][0]];
    const omW = [-phiRate * xB[0], -phiRate * xB[1], -phiRate * xB[2] + w];
    let omB = mul(T(Rwb), omW);
    // vibrations (repère moto) : résonance du support + moteur, actives quand la moto roule/tourne au ralenti
    const tt = t, on = v > 0.5 ? 1 : 0.4;
    const vib = (A, F, k) => A * Math.sin(2 * Math.PI * F * tt + ph[k]) * on;
    const gv = V.gyro || 0, av = V.acc || 0, fr = V.fres || 14, fe = V.feng || 37;
    omB = [omB[0] + vib(gv, fr, 0) + vib(gv * .7, fe, 1) + gauss() * gv * .25, omB[1] + vib(gv * .8, fr * 1.13, 2) + gauss() * gv * .25, omB[2] + vib(gv * .5, fe * 0.91, 3) + gauss() * gv * .2];
    fB = [fB[0] + vib(av, fr, 4) + gauss() * av * .3, fB[1] + vib(av, fr * 1.07, 5) + gauss() * av * .3, fB[2] + vib(av * 1.2, fe, 1) + gauss() * av * .3];
    // bosses : choc bref sur la route abîmée
    if (V.bumps && rnd() < V.bumps * dt) { const k = 8 + rnd() * 10; fB[2] += k; omB[1] += (rnd() - .5) * 3 }
    // téléphone tenu en main : il tourne doucement d'un côté puis de l'autre
    let Rmp = Rpb;
    if (cfg.hand) { const a = cfg.hand * D * Math.sin(2 * Math.PI * 0.55 * tt), b = cfg.hand * .6 * D * Math.sin(2 * Math.PI * 0.31 * tt + 1); Rmp = mm(T(mm(Rx(a), Ry(b))), Rpb);
      const ad = cfg.hand * D * 2 * Math.PI * 0.55 * Math.cos(2 * Math.PI * 0.55 * tt), bd = cfg.hand * .6 * D * 2 * Math.PI * 0.31 * Math.cos(2 * Math.PI * 0.31 * tt + 1);
      omB = [omB[0] + ad, omB[1] + bd, omB[2]] }
    const fP = mul(Rmp, fB), omP = mul(Rmp, omB);
    const n = t0 + Math.round(t * 1000); vH.push(v); const vLag = vH[Math.max(0, vH.length - 1 - Math.round((cfg.lag || 0) * fs))];
    // navigateur : alpha = z, beta = x, gamma = y (°/s) ; Android : accélération incluant la gravité vers le haut
    est.motion(fP[0], fP[1], fP[2], omP[2] / D, omP[0] / D, omP[1] / D, n);
    if (t >= gpsT) {
      gpsT += 1; gx += (gauss() * 1.2 - gx * .3); gy += (gauss() * 1.2 - gy * .3);
      const lat = 36.7 + (Y + gx) / 111320, lng = 3.0 + (X + gy) / (111320 * Math.cos(36.7 * D));
      const spdM = Math.max(0, vLag + gauss() * .25), hdg = v > 1 ? ((90 - psi / D + gauss() * 1.5) % 360 + 360) % 360 : null;
      est.gps(lat, lng, spdM, cfg.noHeading ? null : hdg, n);
    }
    const disp = est.display(n);
    out.push({ seg: segI, rad, t, v: v * 3.6, truth: (car ? phiTrue : phiBike) / D, est: disp, loose: est.looseAt ? est.looseAt(n) : false, straight: Math.abs(w) < 0.01 && Math.abs(wTarget) < 1e-9, steady: rad && segT > 2.5 && segT < dur - 0.5 });
    t += dt; segT += dt; if (segT >= dur) { segI++; segT = 0 }
  }
  return { out, stats: est.stats ? est.stats() : {} };
}

function report(name, cfg) {
  const { out, stats } = simulate(cfg);
  const fast = out.filter(o => o.v >= 20);
  const st = fast.filter(o => o.straight && o.t > 20); // après apprentissage
  const cv = fast.filter(o => o.steady);
  const e = cv.map(o => Math.abs(Math.abs(o.est) - Math.abs(o.truth))).sort((a, b) => a - b), sgn = cv.filter(o => Math.abs(o.truth) > 8 && Math.sign(o.est) !== Math.sign(o.truth)).length;
  const q = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN;
  const sm = st.map(o => Math.abs(o.est)).sort((a, b) => a - b);
  const loose = fast.filter(o => o.loose).length / Math.max(1, fast.length);
  const pk = []; const segs = [...new Set(out.filter(o => o.rad).map(o => o.seg))];
  for (const sg of segs) { const w = out.filter(o => o.seg >= sg && o.seg <= sg + 1 && (o.seg === sg || o.t - out.find(x => x.seg === sg + 1).t < 1.5));
    const mt = Math.max(...w.map(o => Math.abs(o.truth))), me = Math.max(...w.map(o => Math.abs(o.est))); if (mt > 8) pk.push(me - mt); }
  const rMaxT = Math.max(...out.map(o => Math.abs(o.truth))), rMaxE = Math.max(...out.map(o => Math.abs(o.est)));
  const WIN = +(process.env.WIN || 1), fsr = Math.round(1 / (out[1].t - out[0].t)), hw = Math.round(WIN * fsr);
  let rMaxS = 0; for (let i = hw; i < out.length; i++) { const v = out.slice(i - hw, i + 1).map(o => Math.abs(o.est)).sort((a, b) => a - b); rMaxS = Math.max(rMaxS, v[Math.floor(v.length * .5)]); }
  const r = { scenario: name, max_virage_ecart_moy: +(pk.reduce((a, b) => a + b, 0) / Math.max(1, pk.length)).toFixed(1), max_virage_pire: +Math.max(...pk.map(Math.abs)).toFixed(1), max_trajet: rMaxT.toFixed(0) + '° vrai → ' + rMaxE.toFixed(0) + '° app → ' + rMaxS.toFixed(0) + '° tenu', virage_err_moy: +(e.reduce((p, q) => p + q, 0) / Math.max(1, e.length)).toFixed(1), virage_err_p95: +q(e, .95).toFixed(1), mauvais_cote: sgn, droit_p95: +q(sm, .95).toFixed(1), droit_max: +(sm[sm.length - 1] || 0).toFixed(1), alerte_tel_bouge: Math.round(loose * 100) + '%' };
  return r;
}

const SC = [
  ['idéal (comme l’ancien banc)', { route: 'route', mount: 'portrait', vib: { gyro: .6, acc: 3 } }],
  ['vitesse GPS en retard 1 s', { route: 'route', mount: 'portrait', lag: 1, vib: { gyro: .6, acc: 3 } }],
  ['pilote penché dedans (moto à 90 %)', { route: 'route', mount: 'portrait', bike: .9, vib: { gyro: .6, acc: 3 } }],
  ['retard 1 s + pilote dedans', { route: 'route', mount: 'portrait', lag: 1, bike: .9, vib: { gyro: .6, acc: 3 } }],
  ['retard 1 s + pilote dedans + vibrations', { route: 'route', mount: 'portrait', lag: 1, bike: .9, vib: { gyro: 1.2, acc: 6, fres: 14 } }],
  ['retard 1,5 s + pilote dedans 85 %', { route: 'route', mount: 'paysage', lag: 1.5, bike: .85, vib: { gyro: 1, acc: 5 } }],
];
if (require.main !== module) { module.exports = { simulate, report, SC }; return; }
const rows = SC.map(([n, c]) => report(n, c));
console.table(rows);
if (process.argv[4] === 'json') console.log(JSON.stringify(rows));
