// MotoRoute – suivi des plantages avec Sentry (test-33)
// Envoie seulement les erreurs techniques : aucune position GPS, aucune fiche d'urgence,
// aucun nom, e-mail, téléphone ni adresse IP. Les adresses (liens) sont nettoyées.
(function () {
  if (!window.Sentry) return;
  var DSN = 'https://708e5500708273194434849d04aa4b34@o4512288668581888.ingest.de.sentry.io/4512288686604368';
  var native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  var ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  var version = window.MR_VERSION || 'web';

  // Enlève ce qui suit « ? » ou « # » dans un lien (jetons de connexion, filtres, coordonnées…)
  function clean(u) { return typeof u === 'string' ? u.replace(/[?#].*$/, '') : u; }
  // Masque coordonnées GPS, e-mails et numéros de téléphone qui se glisseraient dans un message
  function scrub(s) {
    if (typeof s !== 'string') return s;
    return s
      .replace(/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, '[position]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-mail]')
      .replace(/(?:\+|\b0)\d[\d\s.-]{7,13}\d\b/g, '[téléphone]');
  }

  try {
    Sentry.init({
      dsn: DSN,
      release: 'motoroute@' + version,
      environment: native ? 'android' : (ios ? 'iphone-web' : 'web'),
      sendDefaultPii: false,
      maxBreadcrumbs: 30,
      beforeBreadcrumb: function (b) {
        if (b.category === 'console') return null;            // pas de copie des messages internes
        if (b.category === 'ui.input') return null;           // pas de ce qui est tapé
        if (b.data && b.data.url) b.data.url = clean(b.data.url);
        if (b.data && b.data.from) b.data.from = clean(b.data.from);
        if (b.data && b.data.to) b.data.to = clean(b.data.to);
        if (b.message) b.message = scrub(b.message);
        return b;
      },
      beforeSend: function (e) {
        delete e.user;
        if (e.request) { e.request.url = clean(e.request.url); delete e.request.cookies; delete e.request.headers; delete e.request.query_string; }
        if (e.message) e.message = scrub(e.message);
        (e.exception && e.exception.values || []).forEach(function (x) { x.value = scrub(x.value); });
        return e;
      }
    });
    Sentry.setTag('langue', document.documentElement.lang || 'fr');
  } catch (err) { /* le suivi ne doit jamais bloquer l'application */ }
})();
