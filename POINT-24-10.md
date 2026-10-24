# MotoRoute – Point du 24 octobre 2026 (LIRE EN PREMIER, puis POINT-23-10.md et REPRISE.md)

## 🆕 test-54 (24/10, après-midi) : ce qui manquait face aux concurrents
Suite à l'analyse « MotoRoute — Analyse des applis concurrentes » (Calimoto, REVER, Cardo Ride, Liberty Rider…).
- **Sortie → 🧭 Itinéraire Google Maps / 🚙 Waze** : navigation départ → arrivée en un geste (le guidage virage par virage
  est confié à Google Maps/Waze plutôt que refait dans l'app).
- **Conduite → ⬇ GPX** sur chaque trajet enregistré (les 5 derniers gardent le tracé) : envoi du fichier .gpx
  (partage Android via Filesystem + Share) pour Calimoto, Kurviger, OsmAnd, Google My Maps…
- **Batterie** : % consommé pendant le trajet (et %/h) dans le résumé et l'historique.
  **Économie de batterie** : la carte GPS de l'onglet Conduite est coupée pendant l'enregistrement (avant : 2 GPS + carte rechargée toutes les 6 s).
- **Alerte « motard décroché »** (comme PackRide de Cardo Ride) : pendant le suivi en direct d'une sortie, si un participant est
  à plus de 2 km de moi → vibration + bip + bandeau rouge, même panneau fermé (le suivi reste branché tant que je partage).
- **💬 Contacter MotoRoute** (WhatsApp) en bas de l'onglet Route : s'affiche dès que `window.MR_SUPPORT_WA` (js/route-plus.js) contient le numéro d'Elaid — numéro pas encore donné.
- Code : `www/js/route-plus.js` + quelques lignes dans `www/index.html` ; copie identique dans `docs/app` (iPhone).
- À tester sur téléphone : ⬇ GPX (fenêtre de partage), batterie dans le résumé, alerte décrochage avec les 2 téléphones (s'éloigner de plus de 2 km).

## 📍 Nouveau : « Bonnes adresses sur la route » (test-53)
Décision d'Elaid : **tout membre connecté** ajoute hébergements / motards hôtes, restos-cafés, stations,
mécaniciens, points de vue… avec **position GPS** (celle du téléphone, sur place) et **jusqu'à 4 photos**.
**Pas de validation** : visible tout de suite par tous les membres.
- Entrée : onglet **Route** → carte « 📍 Bonnes adresses sur la route » (Voir / Ajouter) ; aussi depuis
  MotoRoute Plus → Motards hôtes / Annuaire (les anciennes notes locales restent dessous).
- Liste classée par distance, filtres par type, recherche, 🧭 Y aller (Google Maps), 📞, 👍 (un par membre).
- Garde-fous sans validation : 🚩 Signaler (3 membres différents = adresse masquée), l'auteur ou
  l'administrateur supprime, l'administrateur peut réafficher, 15 ajouts max par membre et par 24 h.
- Code : `www/js/places.js` (Android + iPhone). Serveur : `supabase/bonnes-adresses.sql`
  (tables places, place_likes, place_reports ; fonctions mr_place_like / mr_place_report / mr_place_unhide ;
  stockage photos « place-photos », dossier = identifiant du membre ; droits GRANT explicites).

### ✅ Serveur installé et vérifié (24/10, 11 h 45)
- `supabase/bonnes-adresses.sql` exécuté par Elaid (« Success »). Vérifié par Claude : 3 tables avec RLS, 6 règles,
  4 fonctions, déclencheur, stockage public « place-photos », droits GRANT par colonne.
- Essais réels avec 4 comptes (transactions annulées, base restée vide) : ajout OK (auteur = prénom du profil),
  visible par les autres, 👍 un par membre, impossible de modifier/supprimer chez un autre, compteurs non
  modifiables, auto-signalement refusé, masqué au 3ᵉ signalement (l'auteur le voit encore), rien sans compte.
- Règle photos : un membre ne dépose que dans son dossier (= son identifiant), comme le fait l'app.

### ⏳ Reste à tester (téléphone réel, 2 minutes)
- Installer test-53 → Route → 📍 ＋ Ajouter → photo → Publier ; vérifier que la photo s'affiche,
  puis voir l'adresse depuis le 2ᵉ téléphone.
- ⚠️ Aucune photo n'a encore jamais été envoyée sur le stockage Supabase (ni partenaires ni adresses) :
  ce sera le premier envoi réel. En cas d'échec : « regarde Sentry ».

## Fait aussi le 24/10
- Clé Google (Android key Firebase) **restreinte** à com.motoroute.app + SHA-1 de la clé MotoRoute
  (A9:BF:18:6E:…:B5:11:11:4A). Sirène testée après : OK.
- ⚠️ Le jour de la publication Google Play : ajouter sur cette clé l'empreinte SHA-1 « signature d'application »
  donnée par la Play Console.
