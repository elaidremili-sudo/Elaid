# MotoRoute – Point du 24 octobre 2026 (LIRE EN PREMIER, puis POINT-23-10.md et REPRISE.md)

## 🆕 test-56 (24/10, 16 h 30) : itinéraire déplacé et enrichi (demande d'Elaid)
- « 🌀 Proposer un itinéraire » est maintenant **en tête de l'onglet Sorties** (repliable, « Ouvrir ▾ »), plus dans Route.
- Choix : 1) **genre de route** 🌀 sinueuse / 🛣️ dégagée (autoroute, nationale, lignes droites : on garde les variantes avec
  le moins de virages au km puis la plus haute vitesse moyenne) ; 2) **passer par une ville** (facultatif, ex. Mostaganem,
  trouvée par Nominatim, Algérie d'abord) ; 3) 🔁 **boucle** (retour au départ) ou ➡️ **aller simple** jusqu'à la ville ;
  4) sans ville : **durée** 30 min, 1 h, 1 h 30, 2 h, 3 h, 4 h, 6 h, journée.
- Avec une ville : 8 variantes (direct, détours à gauche/droite à l'aller et au retour).
- Chaque proposition : km, durée, **vitesse moyenne**, virages, et **🏙️ Villes traversées** (ville + wilaya, km et temps de route
  pour y arriver, + routes principales A1, N4…) ; la liste des villes part aussi dans le message WhatsApp / groupe.
- Corrigé : après avoir tapé la ville, le premier bouton touché ne répondait pas (la carte se redessinait).

## 🆕 test-55 (24/10, 16 h) : « 🌀 Proposer un itinéraire » (idée d'Elaid)
En haut de l'onglet **Route**. Le motard choisit son temps (1 h, 2 h, 3 h, ½ journée) → « 📍 Chercher autour de moi ».
- L'app prend la position GPS, prépare **8 boucles** qui reviennent au départ (8 directions, taille = temps × 45 km/h)
  avec le calculateur d'itinéraires gratuit **OSRM** (router.project-osrm.org, sans clé, 1 requête/s → ~10 s de recherche).
- Elle **compte les virages** de chaque boucle (cap qui tourne d'au moins 35° sur 200 m ; les impasses/demi-tours sont écartés)
  et garde les **3 plus sinueuses** : tracé, km, durée estimée (sans pauses), nombre de virages, niveau 🌀 / 🌀🌀 / 🌀🌀🌀.
- Boutons : 🧭 Partir (Google Maps, 3 points de passage), ⬇ GPX (tracé exact), 💬 WhatsApp,
  📣 **Proposer à mon groupe** = message dans la discussion du groupe (les liens y sont maintenant cliquables).
- Nom de la ville de départ : Nominatim (OpenStreetMap), gratuit.
- Code : `www/js/itineraire.js` (+ `mrShareGpxText` dans route-plus.js, liens cliquables dans la discussion). Copie dans `docs/app`.
- Limite : OSRM « démo » est gratuit mais sans garantie ; si un jour il sature, passer à openrouteservice (clé gratuite, 2000/jour).
- À tester sur téléphone : vraie recherche autour de chez soi, la qualité des boucles proposées, le message dans un groupe.

> 📄 **Comparatif à montrer aux membres** (MotoRoute vs Cardo Ride/ex-Riser, Calimoto, REVER, Liberty Rider, Kurviger) : `docs-membres/comparatif-applis-moto.md` — version en ligne : https://claude.ai/artifact/Sre1aNBdaCvUYkrSJxAmNa

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
- **💬 Contacter MotoRoute** (WhatsApp) en bas de l'onglet Route : s'affiche dès que `window.MR_SUPPORT_WA` (js/route-plus.js) contient le numéro d'Elaid : 0561 60 94 54 (wa.me/213561609454).
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
