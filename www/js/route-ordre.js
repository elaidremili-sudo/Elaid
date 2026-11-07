/* MotoRoute test-98 (audit du 07/11/2026) : onglet Route allégé.
   - La carte SOS passe tout en haut, avant la Musique.
   - Restent visibles : SOS, Musique, Premiers secours, Détection de chute, Signaler un danger, Bonnes adresses.
   - Le reste (moteur, position et motards proches, notifications, MotoRoute Plus, groupes féminins, contact, GPX…)
     est rangé dans un volet « 🧰 Plus d'outils » ; son état ouvert/fermé est gardé.
   Les cartes sont seulement déplacées dans #main : leurs identifiants et leurs boutons ne changent pas.
   Chargé en dernier pour envelopper toutes les autres versions de render(). */
(function () {
  var W = function (f, a, e) { try { return lang == 'ar' ? a : lang == 'en' ? e : f; } catch (x) { return f; } };
  var KO = 'mr_route_more';
  var isOpen = function () { try { return localStorage.getItem(KO) === '1'; } catch (e) { return false; } };

  function keep(c) {
    if (!c || !c.matches) return true;
    if (c.matches('.mr-sos, .mu-card, .pl-card, details.mr-more, [data-k="fa"]')) return true;
    if (c.querySelector('#fall_chk, [data-hz]')) return true; // détection de chute, signaler un danger
    return false;
  }

  function tidy() {
    try {
      if (typeof tab == 'undefined' || tab != 4) return;
      var m = document.getElementById('main'); if (!m) return;
      var sos = m.querySelector(':scope > .mr-sos');
      if (sos && m.firstElementChild !== sos) m.insertBefore(sos, m.firstElementChild);
      var det = m.querySelector(':scope > details.mr-more');
      var move = Array.prototype.filter.call(m.children, function (c) { return !keep(c); });
      if (!move.length) return;
      if (!det) {
        det = document.createElement('details');
        det.className = 'card mr-more';
        if (isOpen()) det.open = true;
        det.innerHTML = '<summary>🧰 ' + W('Plus d’outils', 'أدوات أخرى', 'More tools') +
          '<small>' + W('Position et motards proches, moteur, notifications, roadbooks GPX, MotoRoute Plus…',
                        'الموقع والدراجون القريبون، المحرك، الإشعارات، مسارات GPX، MotoRoute Plus…',
                        'Position and nearby riders, engine, notifications, GPX roadbooks, MotoRoute Plus…') + '</small></summary><div class="mr-more-in"></div>';
        det.addEventListener('toggle', function () { try { localStorage.setItem(KO, det.open ? '1' : '0'); } catch (e) {} });
      }
      m.appendChild(det);
      var box = det.querySelector('.mr-more-in');
      move.forEach(function (c) { box.appendChild(c); });
    } catch (e) { try { console.error('route-ordre', e); } catch (x) {} }
  }

  var st = document.createElement('style');
  st.textContent = 'details.mr-more>summary{cursor:pointer;font-weight:700;font-size:17px;min-height:48px;display:flex;flex-direction:column;justify-content:center;list-style:none}' +
    'details.mr-more>summary::-webkit-details-marker{display:none}' +
    'details.mr-more>summary::after{content:"▾";position:absolute;inset-inline-end:16px;top:14px;font-size:18px}' +
    'details.mr-more[open]>summary::after{content:"▴"}details.mr-more{position:relative}' +
    'details.mr-more>summary small{font-weight:400;font-size:14px;color:var(--mute);margin-top:2px}' +
    'details.mr-more .mr-more-in>.card{margin-inline:0}';
  document.head.appendChild(st);

  if (typeof render == 'function') {
    var _r = render;
    render = function () { var r = _r.apply(this, arguments); tidy(); setTimeout(tidy, 0); setTimeout(tidy, 400); return r; };
  }
  window.mrRouteTidy = tidy;
})();
