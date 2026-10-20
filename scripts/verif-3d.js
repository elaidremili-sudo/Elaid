// Captures automatiques du replay 3D dans un vrai Chrome (GitHub Actions)
const puppeteer = require('puppeteer-core'); const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const log = []; const L = s => { log.push(s); console.log(s); };
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setViewport({ width: 412, height: 870, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') L('console.' + m.type() + ': ' + m.text()); });
  p.on('pageerror', e => L('PAGEERROR: ' + e.message));
  await p.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  const shot = async n => { await p.screenshot({ path: `out/${n}.png` }); L('capture ' + n); };
  await shot('00-app');
  // 1) démo (format complet : vitesse, temps, altitude)
  await p.evaluate(() => window.mrR3dOpen('demo'));
  await sleep(9000); await shot('01-demo-360');
  const clickTxt = async sel => { await p.evaluate(s => { const b = document.querySelector(s); b && b.click(); }, sel); };
  for (const [k, n] of [['chase', '02-poursuite'], ['drone', '03-drone'], ['side', '04-cote']]) { await clickTxt(`#r3d [data-cam="${k}"]`); await sleep(3500); await shot(n); }
  await clickTxt('#r3d [data-cam="360"]'); await sleep(2500); await shot('05-360-bis'); await sleep(3000); await shot('05b-360-ter');
  await clickTxt('#r3d [data-cam="cine"]'); await sleep(7500); await shot('05c-cinema');
  await clickTxt('#r3d [data-k="gnd"]'); await sleep(6000); await shot('05d-carte-osm'); await clickTxt('#r3d [data-k="gnd"]'); await clickTxt('#r3d [data-cam="360"]');
  await clickTxt('#r3d [data-k="ab"]'); await sleep(500);
  await p.evaluate(() => { const a = document.querySelector('#r3d .ra'), b = document.querySelector('#r3d .rb'); a.value = 300; a.dispatchEvent(new Event('input')); b.value = 600; b.dispatchEvent(new Event('input')); });
  await sleep(1500); await shot('06-tronçon-AB');
  // enregistrement vidéo ×30 sur le tronçon
  await clickTxt('#r3d [data-sp="30"]'); await clickTxt('#r3d [data-k="rec"]'); await sleep(2500); await shot('07-enregistrement');
  let ok = false; for (let i = 0; i < 40 && !ok; i++) { await sleep(1000); ok = await p.evaluate(() => !!document.querySelector('#r3d .out video')); }
  const vid = await p.evaluate(async () => { const v = document.querySelector('#r3d .out video'); if (!v) return null; const r = await fetch(v.src); const bl = await r.blob(); return { size: bl.size, type: bl.type }; });
  L('VIDEO: ' + JSON.stringify(vid)); await shot('08-video-prete');
  await p.evaluate(() => window.mrR3dClose());
  // 2) ancien format de trajet (3 valeurs par point : lat, lng, inclinaison) sans temps ni altitude
  await p.evaluate(() => { const d = (function () { const tk = []; let la = 36.75, ln = 3.05, h = 0; for (let i = 0; i < 140; i++) { h += Math.sin(i / 9) * 0.12; la += 25 * Math.cos(h) / 111320; ln += 25 * Math.sin(h) / (111320 * Math.cos(la * Math.PI / 180)); tk.push([+la.toFixed(5), +ln.toFixed(5), Math.round(Math.abs(Math.sin(i / 9)) * 30)]); } return tk; })();
    S.rides = [{ id: 1760000000000, d: '2026-10-18', km: 3.5, dur: 260, vmax: 88, vavg: 48, lL: 30, lR: 28, vc: 60, vca: 50, tk: d }].concat((S.rides || []).filter(r => r.id !== 1760000000000)); window.mrR3dOpen(1760000000000); });
  await sleep(8000); await shot('09-ancien-trajet');
  await p.evaluate(() => window.mrR3dClose());
  // 3) carte « Revoir en 3D » dans l'onglet Conduite
  await p.evaluate(() => { const g = document.querySelector('dialog[open]'); g && g.close && g.close(); const t = [...document.querySelectorAll('nav button')].find(x => /Conduite/.test(x.textContent)); t && t.click(); });
  await sleep(1200); await p.evaluate(() => { const c = [...document.querySelectorAll('.card h3')].find(h => /3D/.test(h.textContent)); c && c.scrollIntoView(); }); await sleep(600); await shot('10-carte-conduite');
  // 4) fenêtre d'information MotoRoute (remplace alert)
  await p.evaluate(() => alert('Test : fenêtre d’information MotoRoute')); await sleep(400); await shot('11-alerte-stylee');
  // 5) alerte SOS reçue (simulation d'affichage)
  fs.writeFileSync('out/log.txt', log.join('\n'));
  await b.close();
})().catch(e => { console.error(e); fs.writeFileSync('out/erreur.txt', String(e && e.stack || e)); process.exit(1); });
