// Fabrique un film de démonstration « Revoir mon trajet en 3D » sur un vrai itinéraire :
// Haïzer → col de Tikjda (Bouira), pilote : Elaid sur sa Kawasaki Z H2.
const puppeteer = require('puppeteer-core'); const fs = require('fs'); const { execSync } = require('child_process');
const _log = console.log; console.log = (...a) => { _log(...a); try { fs.mkdirSync('out', { recursive: true }); fs.appendFileSync('out/log-simulation.txt', a.join(' ') + '\n'); } catch (e) {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const D2R = Math.PI / 180, R = 6371000;
const hv = (a, b) => { const dl = (b[0] - a[0]) * D2R, dn = (b[1] - a[1]) * D2R, x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const brg = (a, b) => Math.atan2(Math.sin((b[1] - a[1]) * D2R) * Math.cos(b[0] * D2R), Math.cos(a[0] * D2R) * Math.sin(b[0] * D2R) - Math.sin(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.cos((b[1] - a[1]) * D2R));
(async () => {
  fs.mkdirSync('out/frames', { recursive: true });
  const A = [36.4006, 3.9985], B = [36.4545, 4.1296]; // Haïzer → station de Tikjda
  const r = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${A[1]},${A[0]};${B[1]},${B[0]}?overview=full&geometries=geojson`)).json();
  const line = r.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
  console.log('OSRM', (r.routes[0].distance / 1000).toFixed(1), 'km,', line.length, 'points');
  // un point tous les 25 m
  const pts = [line[0]]; let acc = 0;
  for (let i = 1; i < line.length; i++) { let a = line[i - 1], b = line[i], d = hv(a, b);
    while (acc + d >= 25) { const f = (25 - acc) / d; const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; pts.push(p); d -= 25 - acc; a = p; acc = 0; }
    acc += d; }
  pts.push(line[line.length - 1]);
  // altitude (Open-Meteo, par paquets de 100)
  const alt = [];
  for (let i = 0; i < pts.length; i += 100) { const ch = pts.slice(i, i + 100);
    let got = null;
    for (let k = 0; k < 4 && !got; k++) {
      try { const j = await (await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${ch.map(p => p[0].toFixed(5)).join(',')}&longitude=${ch.map(p => p[1].toFixed(5)).join(',')}`)).json();
        if (Array.isArray(j.elevation)) got = j.elevation; else console.log('open-meteo', JSON.stringify(j).slice(0, 200)); } catch (e) { console.log('open-meteo err', e.message); }
      if (!got) { try { const j = await (await fetch(`https://api.opentopodata.org/v1/srtm90m?locations=${ch.map(p => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join('|')}`)).json();
        if (j.results) got = j.results.map(x => x.elevation); else console.log('opentopodata', JSON.stringify(j).slice(0, 200)); } catch (e) { console.log('opentopodata err', e.message); } }
      if (!got) await sleep(2500 * (k + 1));
    }
    if (!got) throw new Error('altitude indisponible');
    alt.push(...got); await sleep(1100); }
  // vitesse réaliste selon le rayon du virage (+ freinage / accélération), inclinaison physique
  const n = pts.length, rad = new Array(n).fill(1e9), side = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) { let dh = brg(pts[i], pts[i + 1]) - brg(pts[i - 1], pts[i]); while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    rad[i] = Math.abs(dh) > 1e-3 ? 25 / Math.abs(dh) : 1e9; side[i] = Math.abs(dh) < 0.03 ? 0 : (dh > 0 ? 1 : -1); }
  // rayon du virage = le plus serré sur ±2 points (on freine avant, on remet les gaz après)
  const rad2 = rad.map((_, i) => Math.min(...rad.slice(Math.max(0, i - 2), i + 3))); for (let i = 0; i < n; i++) rad[i] = Math.max(12, rad2[i]);
  let v = rad.map(rr => Math.max(28, Math.min(92, Math.sqrt(9.81 * rr * Math.tan(38 * D2R)) * 3.6)));
  for (let k = 0; k < 2; k++) v = v.map((x, i) => (v[Math.max(0, i - 1)] + x * 2 + v[Math.min(n - 1, i + 1)]) / 4);
  for (let i = 1; i < n; i++) v[i] = Math.min(v[i], Math.sqrt((v[i - 1] / 3.6) ** 2 + 2 * 2.6 * 25) * 3.6);
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt((v[i + 1] / 3.6) ** 2 + 2 * 4.5 * 25) * 3.6);
  v[0] = 20; let t = 0;
  const tk = pts.map((p, i) => { if (i) t += 25 / (((v[i] + v[i - 1]) / 2) / 3.6); const vs = v[i] / 3.6, lean = Math.min(38, Math.atan(vs * vs / (9.81 * rad[i])) / D2R);
    return [+p[0].toFixed(5), +p[1].toFixed(5), Math.round(lean), lean < 3 ? 0 : side[i], Math.round(v[i]), Math.round(t), Math.round(alt[i])]; });
  const km = (pts.length - 1) * 25 / 1000;
  console.log('Trajet', km.toFixed(1), 'km,', Math.round(t / 60), 'min, altitude', Math.min(...alt), '→', Math.max(...alt), 'm, vmax', Math.round(Math.max(...v)), 'inclinaison max', Math.max(...tk.map(q => q[2])), '°, virages ≥ 35° :', tk.filter(q => q[2] >= 35).length);
  fs.writeFileSync('out/trajet-tikjda.json', JSON.stringify(tk));

  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage();
  await p.setViewport({ width: 720, height: 1280, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('http://localhost:8080/index.html', { waitUntil: 'load', timeout: 120000 }); await sleep(3000);
  // carte du trajet (OpenStreetMap)
  const map = await p.evaluate(async tk => {
    const z = 13, tx = l => (l + 180) / 360 * 2 ** z, ty = la => (1 - Math.log(Math.tan(la * Math.PI / 180) + 1 / Math.cos(la * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
    const xs = tk.map(q => tx(q[1])), ys = tk.map(q => ty(q[0])); const x0 = Math.floor(Math.min(...xs)) , x1 = Math.floor(Math.max(...xs)), y0 = Math.floor(Math.min(...ys)), y1 = Math.floor(Math.max(...ys));
    const c = document.createElement('canvas'); c.width = (x1 - x0 + 1) * 256; c.height = (y1 - y0 + 1) * 256; const g = c.getContext('2d');
    await Promise.all([...Array(x1 - x0 + 1)].flatMap((_, i) => [...Array(y1 - y0 + 1)].map((_, j) => new Promise(ok => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { g.drawImage(im, i * 256, j * 256); ok(); }; im.onerror = ok; im.src = `https://tile.openstreetmap.org/${z}/${x0 + i}/${y0 + j}.png`; }))));
    const P = q => [(tx(q[1]) - x0) * 256, (ty(q[0]) - y0) * 256];
    g.lineJoin = g.lineCap = 'round'; g.strokeStyle = '#ffffff'; g.lineWidth = 11; g.beginPath(); tk.forEach((q, i) => { const [a, b2] = P(q); i ? g.lineTo(a, b2) : g.moveTo(a, b2); }); g.stroke();
    for (let i = 1; i < tk.length; i++) { const l = tk[i][2]; g.strokeStyle = l < 20 ? '#22c55e' : l < 35 ? '#f5b301' : '#ef4444'; g.lineWidth = 6; g.beginPath(); g.moveTo(...P(tk[i - 1])); g.lineTo(...P(tk[i])); g.stroke(); }
    [[tk[0], '#22c55e', 'A'], [tk[tk.length - 1], '#111', 'B']].forEach(([q, col, tx_]) => { const [a, b2] = P(q); g.fillStyle = col; g.beginPath(); g.arc(a, b2, 16, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.fillText(tx_, a, b2 + 6); });
    g.fillStyle = '#000a'; g.fillRect(0, c.height - 26, 230, 26); g.fillStyle = '#fff'; g.font = '14px sans-serif'; g.textAlign = 'left'; g.fillText('© OpenStreetMap contributors', 8, c.height - 8);
    return c.toDataURL('image/png');
  }, tk);
  fs.writeFileSync('out/carte-trajet-tikjda.png', Buffer.from(map.split(',')[1], 'base64'));
  // film
  await p.evaluate(tk => { const g = document.querySelector('dialog[open]'); try { g && g.close(); } catch (e) {}
    S.me = Object.assign(S.me || {}, { moto: 'Kawasaki Z H2', name: 'Elaid' }); window.MR3D_FILM_S = 75;
    S.rides = [{ id: 1760900000000, d: '2026-10-20', km: 0, dur: tk[tk.length - 1][5], tk }].concat((S.rides || []).filter(r => r.id !== 1760900000000));
    window.mrR3dOpen(1760900000000); }, tk);
  await sleep(6000);
  await p.evaluate(() => { const c = document.querySelector('#r3d [data-cam="cine"]'); c && c.click(); window.mrR3dManual(30); });
  let i = 0, st;
  do { st = await p.evaluate(() => window.mrR3dTick());
    const d = await p.evaluate(() => document.querySelector('#r3d canvas.v').toDataURL('image/jpeg', 0.9));
    fs.writeFileSync(`out/frames/f${String(i).padStart(5, '0')}.jpg`, Buffer.from(d.split(',')[1], 'base64')); i++;
    if (i % 150 === 0) console.log('image', i, 't', Math.round(st.t), '/', Math.round(st.tb));
  } while (!st.done && i < 3000);
  for (let k = 0; k < 45; k++) fs.copyFileSync(`out/frames/f${String(i - 1).padStart(5, '0')}.jpg`, `out/frames/f${String(i + k).padStart(5, '0')}.jpg`);
  await b.close();
  execSync(`ffmpeg -y -loglevel error -framerate 30 -i out/frames/f%05d.jpg -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -movflags +faststart out/simulation-elaid-zh2-tikjda.mp4`);
  execSync('rm -rf out/frames');
  console.log('FILM OK', i, 'images', fs.statSync('out/simulation-elaid-zh2-tikjda.mp4').size, 'octets');
})().catch(e => { console.error(e); fs.writeFileSync('out/erreur.txt', String(e && e.stack || e)); process.exit(1); });
