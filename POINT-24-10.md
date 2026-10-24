# MotoRoute – Point du 24 octobre 2026 (LIRE EN PREMIER, puis POINT-23-10.md et REPRISE.md)

## 🆕 test-61 (24/10, 23 h) : compte AdMob créé et branché
- Compte AdMob d'Elaid créé (profil de paiement AdSense Algérie, ELAID REMILI, seuil 70 €). Approbation du compte :
  se fera après la publication sur Google Play et l'examen de l'app (rien à faire dans « Validation » pour l'instant).
- App AdMob « Motoroute » (Android, non publiée) : ID d'application `ca-app-pub-9115324413258436~7133412146`
  (inscrit dans `scripts/patch-android.js`, va dans le manifeste Android).
- Bloc « Bannière bas » : `ca-app-pub-9115324413258436/4667030903` (inscrit dans `www/index.html`, `BANNER_ID`).
- `TESTING=true` gardé exprès : pubs de test même avec les vrais identifiants (pas de clic invalide pendant les essais
  ni pendant le test fermé à 12 testeurs). **Le jour de la mise en production : passer `TESTING=false`**, puis dans AdMob
  « Ajouter une plate-forme de téléchargement » pour relier l'app à Google Play.
- Les variables GitHub ADMOB_APP_ID / ADMOB_BANNER_ID ne sont plus nécessaires (Claude ne peut pas les régler).
- Vérifié sur le téléphone le 24/10 : Bonnes adresses avec photo, vitrine pro (demande → validation → publication),
  bas des pages (test-58), Proposer un itinéraire, plus de 2ᵉ rafraîchissement au changement de rubrique (test-60).

## 🆕 test-60 (24/10, 22 h) : plus de second rafraîchissement au changement de rubrique
- Style Futuriste : l'animation d'entrée des cartes passait de « up » à « fxIn » puis revenait à « up » 0,9 s après
  (retrait de la classe fx-enter) → les cartes disparaissaient et réapparaissaient. Une seule animation désormais. Validé par Elaid.

## 🆕 test-59 (24/10, 21 h) : écran qui « coupe » et se rafraîchit tout seul (signalé par Elaid)
Causes trouvées dans le code et corrigées (Android + iPhone) :
- **Tout l'onglet était effacé puis recréé** à chaque mise à jour → nouveau module `www/js/ecran-stable.js` :
  seules les cartes qui changent sont mises à jour ; photos, vidéos et défilement restent en place.
  Changement d'onglet ou de langue : affichage complet comme avant. Testé onglet par onglet : résultat identique à l'ancien affichage.
- **Annonces redessinées toutes les 30 s même sans changement** (vitrines + annonces des membres) → redessin seulement si les données ont changé.
- **Renouvellement de connexion (toutes les heures, retour dans l'appli) = tout redessiné de force** → resynchronisation seulement si le compte change.
- **Écran de connexion** : si la session disparaît un court instant (réseau), on attend 3 s avant de fermer les fenêtres ouvertes.
- **Vidéos de fond** : le second lecteur se prépare 3 s avant la fin et le fondu attend qu'il diffuse vraiment (avant : passage à la photo fixe = coupure).
À vérifier sur le téléphone : rester 2 min sur Annonces, sortir/revenir dans l'appli, regarder les vidéos de fond.

## 🆕 test-57 (24/10, 20 h) : système d'annonces refait (bugs signalés par Elaid)
**Bug 1 – annonce d'Ali (GSX-R) invisible sur le téléphone d'Elaid** : les annonces des membres étaient gardées
seulement dans la mémoire du téléphone qui publiait. Maintenant elles sont sur Supabase (table `annonces`).
- Onglet Annonces en 2 parties : **🏍 Annonces des membres** / **🏪 Vitrines des pros**.
- « ＋ Publier une annonce » : vendre/acheter, moto / pièce / **équipement**, prix, ville, **téléphone/WhatsApp**,
  **jusqu'à 4 photos**, année/km/papiers pour une moto. Visible tout de suite par tous (pas de validation).
- Sur chaque annonce : **💬 WhatsApp** (message prérempli) et **📞 Appeler** le vendeur, ♡ favori, 🚩 Signaler
  (3 membres = masquée). Pour l'auteur : ✅ Vendu, 🔄 Prolonger (expiration 60 jours), 🗑 Supprimer.
  Administrateur : supprimer n'importe quelle annonce, 👁 réafficher. Filtre « 👤 Mes annonces ».
- Code : `www/js/annonces.js`. Serveur : **`supabase/annonces.sql` à exécuter par Elaid dans le SQL Editor**
  (l'installation lancée par Claude a été annulée depuis le téléphone).
- Les anciennes annonces de démonstration (MT-07, casque, pot CB500F) ne s'affichent plus.

**Bug 2 – « Parcourir » ouvrait Drive / Récents au lieu des photos du téléphone** : nouveau module `www/js/photos.js`
+ module Capacitor `@capacitor/camera` (package.json). Boutons **🖼 Galerie** (vrai sélecteur de photos Android :
Photos + Albums) et **📷 Prendre une photo**. Branché aussi sur les Bonnes adresses et la photo des vitrines.
Sur iPhone / navigateur : champ fichier classique.

**Point 3 – partenaires : on ne savait pas comment entrer** : en haut de « Vitrines des pros », carte
**« Vous êtes un magasin, un garage ou un vendeur moto ? »** avec les 3 étapes, **📝 Demander ma vitrine** (formulaire :
nom, activité, ville, téléphone, message) et **🔑 J'ai un code** (codes à 10 caractères, texte corrigé).
- La demande arrive chez l'administrateur dans **🛡 Publications à valider** → ✅ Accepter : la vitrine est créée,
  le demandeur la gère tout de suite depuis son compte (plus besoin de code), et l'app propose de le prévenir sur WhatsApp.
- Le partenaire voit ensuite **« 🏪 Mon espace pro → ⚙ Gérer ma vitrine »** en haut.
- Serveur : table `partner_requests`, fonctions `mr_partner_request` et `mr_partner_request_decide` (même script annonces.sql).

À tester : exécuter annonces.sql → installer test-57 → annonce avec photos sur le compte d'Ali → visible sur le compte d'Elaid ;
Galerie ; demande de vitrine depuis le 2e téléphone puis Accepter sur le compte administrateur.

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

## 🆕 test-62 (24/10, 23 h) : publicité plein écran (interstitiel), rare et sans danger
Choix retenu : **la bannière reste** (Annonces, liste des groupes, Carnet) + **un plein écran occasionnel** aux moments calmes.
- Quand : juste après **« Annonce publiée »**, ou toutes les **6 navigations** entre Annonces / Groupes / Carnet.
- Jamais : pendant un trajet enregistré, sur Route / Conduite / SOS / Bonnes adresses, quand une fenêtre est ouverte, en paysage,
  au **premier lancement**, dans les **3 premières minutes**, moins de **6 min** après la précédente, plus de **3 par jour**.
- Simulé (9 scénarios) : 1er lancement 0 · trajet 0 · Route/Conduite 0 · après une annonce 1 · journée de 3 h = 3 maximum.
- Code : bloc « Publicités AdMob » de `www/index.html` (`INTER_ID`, `window.mrAdBreak`), `window.mrRiding` (Conduite), appel dans `www/js/annonces.js`.
- test-63 : bloc interstitiel MotoRoute créé par Elaid (`ca-app-pub-9115324413258436/5213825810`) mis dans `INTER_ID`. Pubs de test tant que `TESTING=true` (passer à false à la mise en production Google Play).
- test-64 : Elaid signale « la pub plein écran ne marche pas » sur test-63 (aucune erreur Sentry). Cause probable : en test, les règles
  de production bloquaient tout essai immédiat (2ᵉ lancement, 3 min d'attente, chargement après 60 s). En **mode test** (`TESTING=true`)
  les règles sont allégées : dès le 1er lancement, 20 s après l'ouverture, 1 min entre deux pubs ; si la pub ne s'affiche pas après une
  annonce, un message 🧪 dit pourquoi (et Sentry reçoit « Pub plein écran : … »). Règles complètes inchangées en production (simulées).
- Supprimer un groupe : Groupes → ouvrir le groupe → tout en bas « Supprimer le groupe » (seulement le créateur, pour un groupe du serveur).

