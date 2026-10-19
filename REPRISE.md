# MotoRoute – Point de reprise

**Dernière mise à jour : 19 octobre 2026, 20 h 40 — dernière version : test-29 (Android + iPhone, à tester). test-25 = même contenu que test-24 (fabriquée lors de la mise en ligne iPhone).**

⚠️ Règle : chaque changement de `www/` est aussi copié dans la version iPhone (`scripts/maj-version-web.sh`) dans le même envoi.
Pour reprendre, dis simplement à Claude : « On reprend MotoRoute, lis REPRISE.md dans mon dépôt Elaid ».

## Où tout se trouve

| Quoi | Où |
| --- | --- |
| Code de l'application | dépôt GitHub `elaidremili-sudo/Elaid`, fichier `www/index.html` |
| Version Android à installer | onglet **Releases** du dépôt (dernière : **test-21**) |
| Fichier pour Google Play (.aab) | même release, `MotoRoute-21.aab` |
| Présentation animée | `www/presentation.html` (+ `www/lib/three.min.js`) |
| Scripts SQL Supabase | dossier `supabase/` (déjà exécutés : `suppression.sql`, `validation-groupes.sql`, `playlists.sql` le 19/10) |
| Pages web publiques | `elaidremili-sudo.github.io/Elaid/` → `confidentialite.html`, `suppression-compte.html`, `nouveau-mot-de-passe.html` |
| Images Play Store | dossier `play-store/` (icône 512, bannière 1024×500, 5 captures) |
| Textes Play Store | doc Claude « MotoRoute – Fiche Google Play » |
| Clé de signature | Google Drive, dossier « Secret » (`motoroute-upload.keystore` + `motoroute-cle-secrets.txt`) — ne jamais partager |
| Serveur | Supabase, projet « Motoroute » (`ixtqlxltwuktpdznbhnx`) |
| E-mails (mot de passe oublié, confirmation) | Brevo (offre gratuite, 300 e-mails/jour), branché dans Supabase → Authentication → Emails → SMTP Settings |

## Comment une nouvelle version est fabriquée

Chaque envoi de code sur GitHub fabrique automatiquement une APK **signée** (secrets `MR_KEYSTORE` + `MR_KEY_PASS`) et un `.aab`, publiés dans Releases sous `test-N`. Les versions s'installent **par-dessus** l'ancienne, sans désinstaller.

## E-mails via Brevo (fait le 18/10, 22 h)

- Réglages SMTP dans Supabase : hôte `smtp-relay.brevo.com`, port `587`, identifiant `bec204001@smtp-brevo.com`, mot de passe = clé SMTP Brevo « Supabase MotoRoute » (rangée dans le dossier « Secret », sans date d'expiration).
- **Testé** : « Mot de passe oublié » → e-mail reçu → page « Nouveau mot de passe » → reconnexion OK.
- ⚠️ La clé Brevo **expire après 90 jours sans aucun envoi**. Si les e-mails n'arrivent plus un jour : Brevo → SMTP & API → générer une nouvelle clé → la recoller dans Supabase (champ Password).
- Ne **pas** activer le blocage des IP dans Brevo (Supabase envoie depuis des adresses qui changent).

## Version web pour iPhone (19/10, 19 h 45)

- Adresse : **https://elaidremili-sudo.github.io/Elaid/app/** — même app que l'APK (dossier `docs/app` = copie de `www`). Sur iPhone : ouvrir dans **Safari** → bouton Partager → « Sur l'écran d'accueil ».
- Après chaque changement de `www/`, relancer `scripts/maj-version-web.sh` pour mettre la version web à jour.
- 20 h 05 : lien vérifié en ligne (même fichier que `www/index.html`) et transmis à Elaid pour son ami à iPhone ; à faire : retour de l'ami (installation, connexion, GPS, musique).
- Limites sur iPhone : pas de pub AdMob, l'écran peut se mettre en veille, GPS/capteurs seulement app ouverte, bouton « Quitter » sans effet. Vraie app iPhone = compte Apple Developer (99 $/an) + TestFlight, plus tard.

## Version test-29 (19/10, 21 h 35) — l'écran ne clignote plus dans la comparaison

- Vidéo d'Elaid : le tableau de comparaison disparaissait/réapparaissait chaque seconde. Cause : la carte « Ma position (GPS) » de Conduite continuait de suivre le GPS alors qu'elle n'était plus affichée (vue Comparaison) ; à chaque position elle redessinait tout l'écran (et le tableau revenait au début).
- Correctif : le suivi GPS de cette carte est coupé tant que la comparaison est ouverte, il repart au « Retour ». Mesuré dans le navigateur avec un faux GPS : 6 redessins en 6 s avant, 0 après.

## Version test-28 (19/10, 21 h 15) — Inclinaison colorée qui marche vraiment

- **Conduite enregistre maintenant le tracé GPS** du trajet : un point tous les ~25 m (ou 5 s), avec l'inclinaison max entre deux points (au-dessus de 15 km/h). Max 3000 points par trajet ; le tracé est gardé pour les 5 derniers trajets seulement (place sur le téléphone). Aussi sauvé dans l'enregistrement de secours si l'app se ferme.
- **Route → MotoRoute Plus → « 🏍 Inclinaison colorée »** : dessine le dernier trajet en couleurs (vert < 20°, jaune 20–35°, rouge > 35°), départ en vert, arrivée en noir. L'ancien texte « arrivera avec la version Android » est retiré.
- **« ▶ Voir une simulation »** : un col de montagne fictif se dessine en 9 s avec « En ce moment : 29° à gauche · 55 km/h », boutons Rejouer / Fermer.
- Défis & badges : la phrase « classement entre motards demandera un serveur » est remplacée par « Conduite → 📊 Comparer ».
- Testé dans un navigateur avec faux GPS + faux gyroscope : 40 s de trajet → 400 points enregistrés et dessinés.
- Pas de fond de carte sous le tracé (dessin seul) ; une vraie carte en fond pourra venir plus tard.

## Version test-27 (19/10, 21 h) — comparaison plus facile à trouver

- Elaid ne trouvait pas la comparaison : le bouton n'apparaissait que sur les trajets enregistrés à partir de test-26 (ses anciens n'ont pas de départ/arrivée).
- Onglet **Conduite**, sous la carte vitesse/inclinaison : nouvelle carte **« 📊 Comparaison du trajet »** qui explique où toucher, dit si aucun trajet n'est encore comparable, et propose **« 👀 Voir un exemple »** (données fictives marquées « Exemple », onglets Mon évolution et Membres).
- Le bouton « 📊 Comparer » est maintenant visible sous **tous** les trajets ; sur un ancien trajet il explique pourquoi la comparaison est impossible.

## Version test-26 (19/10, 20 h 40) — comparaison d'un même trajet + pub

- **Comparaison du trajet** (onglet Conduite → bouton « 📊 Comparer » sur un trajet de l'historique ou dans le résumé). Pas une course : un tableau, une colonne par passage ou par pilote.
  - « Mon évolution » : mes passages sur le même trajet (6 derniers), le plus récent visible en premier, + « Depuis ton premier passage : ⏱ x:xx plus rapide · 📐 +x° ».
  - « Membres » : les membres actifs de mes groupes qui ont fait le même trajet (leur dernier passage). Il faut cocher « Partager mes trajets avec mes groupes » (désactivé par défaut). Les autres ne voient que le prénom et les chiffres, jamais la position.
  - Badges seulement sur ⏱ meilleur temps et 📐 plus penché ; vitesses moyenne/max/en virage affichées simplement, sans badge (choix d'Elaid).
  - « Même trajet » = même départ et même arrivée à 500 m près + distance ± 20 % (min. 1 km), ou la même sortie du club (sortie du jour à laquelle on participe).
  - Les trajets enregistrés avant test-26 n'ont pas de départ/arrivée : pas de bouton Comparer pour eux.
- **Serveur : exécuter `supabase/comparaison-trajets.sql`** (table `trajets` + fonction `trajets_comparables`). Sans ça, l'onglet Membres affiche « pas encore activée sur le serveur » ; « Mon évolution » marche sans serveur. Testé sur une base d'essai : seul le dernier passage des membres actifs ressort (ni membres en attente, ni inconnus) et personne ne lit directement les lignes des autres.
- **Pub AdMob** : la bannière se calait sur la hauteur de la barre du bas sans compter qu'elle flotte (style Futuriste) → elle chevauchait la barre ; le bouton ＋ était à hauteur fixe. Maintenant la bannière se place au-dessus du bord haut de la barre et le ＋ au-dessus de la bannière (selon sa vraie hauteur). À vérifier sur le téléphone (Annonces, Groupes, Carnet).

## Version test-24 (19/10, 19 h 30)

- **Barre du haut complète** (langue, 🔑 compte, ?, 🎨, 🪪, 🎬) : elle était décalée de 14 px vers la gauche en style Futuriste, et trop large sur téléphone → « FR » coupé. Corrigé (marges égales, boutons un peu plus compacts sous 440 px de large), vérifié à 360 et 393 px.
- **Paysage plein écran** : l'app s'affiche aussi du côté de la caméra (plus de bande noire à gauche) — réglage Android `windowLayoutInDisplayCutoutMode = shortEdges` ajouté par `scripts/patch-android.js` ; marges de sécurité CSS (`safe-area-inset-left/right`) pour la barre du bas et le bouton ＋.
- **Pub AdMob masquée en paysage** (elle recouvrait la moitié de l'écran et la barre du bas) ; elle revient en portrait.

## Versions test-22 et test-23 (19/10, soir) — style Futuriste + vidéos dans les rubriques

- **Style « Futuriste » par défaut** (Apparence → Style : Futuriste / Classique) : cartes en verre avec contour lumineux aux couleurs du thème, boutons en dégradé avec reflet qui passe et effet d'onde au toucher, bouton ＋ lumineux qui pulse, barre du bas flottante en verre avec l'onglet actif qui brille, fenêtres et champs assortis, apparition animée des cartes au changement d'onglet. Respecte les couleurs, formes (rond/doux/carré), clair/sombre, FR/AR/EN et « mouvements réduits » du téléphone. « Classique » remet l'ancien look.
- **Bandeau vidéo en haut de chaque rubrique** (Sorties, Annonces, Groupes, Route, Conduite, Carnet) : clip réaliste en boucle, titre de la rubrique style HUD + phrase d'accroche (FR/AR/EN), coins lumineux. Fichiers `www/video/tab_1.mp4`… `tab_6.mp4` (640×360) + images d'attente `tab_N.jpg`. Numéros = onglets : 1 Sorties, 2 Annonces, 3 Groupes, 4 Route, 6 Conduite, 5 Carnet.
- **Fond vidéo plein écran au choix** (Apparence → Fond → Vidéo) : clip vertical derrière toute la rubrique (`tabv_N.mp4`, 540×960). Une seule vidéo joue à la fois, rien ne joue quand l'app est en arrière-plan.
- Poids ajouté : environ 10,5 Mo.
- **Fond d'écran assorti** (Fond → Photo, par défaut) : l'ancienne photo de moto rouge est remplacée, en style Futuriste, par l'image réaliste de chaque rubrique (`tabv_N.jpg`), avec un lent mouvement de caméra et un fondu au changement d'onglet. « Ma photo » et « Uni » inchangés.

## Version test-21 (19/10)

- **Présentation en vidéos réalistes** : chaque scène (9) a son clip vidéo réaliste en fond, généré par IA (Veo 3.1 Lite, 8 s, vertical) — col de Tikjda à l'aube avec une hyper naked type Z H2 (ouverture), groupe qui monte vers le Djurdjura, club à la station, photo de groupe au sommet, moto orange dans un virage, entraide au coucher du soleil, file de motos sur la crête au crépuscule, boutique moto de village la nuit, survol du Djurdjura au lever du soleil. Fichiers `www/video/scene1.mp4` à `scene9.mp4` (540×960, sans son, 8,4 Mo en tout). Textes, maquettes et voix inchangés ; le décor 3D reste en secours si une vidéo ne se charge pas (et ne tourne plus pendant les vidéos, économie de batterie).
- Les clips sont arrivés dans le dépôt par l'action GitHub « Récupérer les vidéos de la présentation » (`.github/workflows/videos.yml`, liste `www/video/sources.txt`). Pour remplacer un clip : changer son lien dans `sources.txt`.
- Correctif : « NaN » dans Vmax / Angle max de la scène Conduite.
- Vidéo bonus (hors app) : Z H2 en 360° glace → feu dans un garage, « variante A » validée par Elaid.

## Version test-19 (19/10)

- Éditeur 🎬 : le bouton « Caméra » ne proposait que la vidéo (Android choisit la vidéo quand on demande photo + vidéo à la fois). Remplacé par deux boutons : **📷 Photo** et **🎥 Vidéo**.

## Version test-18 (19/10)

- **Compte obligatoire** : sans connexion, l'app reste bloquée sur l'écran « Bienvenue sur MotoRoute » (connexion / création de compte / mot de passe oublié / confidentialité), fond opaque, impossible de le fermer (retour, Échap, autre fenêtre : il revient). Le bouton devient « Quitter » et ferme l'application (module `@capacitor/app`). La présentation passe avant, puis l'écran s'ouvre sur « Créer un compte ». Une déconnexion ou une suppression de compte ramène sur cet écran ; la musique s'arrête.
- Le module Supabase est maintenant dans l'app (`www/lib/supabase.js`, v2.45.4) au lieu d'être chargé depuis internet : un membre déjà connecté garde l'accès même sans réseau au démarrage.
- ⚠️ Google Play : comme l'app exige un compte, il faudra donner un compte de test à Google dans la Play Console (Contenu de l'application → Accès à l'application).

## Version test-17 (19/10)

- **Retouche IA dans l'éditeur 🎬** (tout se fait sur le téléphone, rien n'est envoyé) : « ✨ Améliorer » (lumière, contraste, couleurs automatiques), curseur Couleurs, « 🙂 Flouter les visages » (MediaPipe Face Detection, Apache 2.0, fichiers dans `www/lib/mp-face/`, analyse en plusieurs passes pour les visages lointains des photos de groupe), « ✋ Flouter une zone » (toucher la photo pour pixeliser une plaque ou un visage, toucher un flou pour le retirer), « ↺ Retirer les flous ». Pour une vidéo, les flous restent fixes.
- **Film souvenir** (page d'un groupe, au-dessus des photos) : jusqu'à 15 photos du groupe assemblées en vidéo verticale 720×1280 (titre, effet de zoom, légendes, fin MotoRoute) avec musique générée par l'app (libre de droits) → Télécharger (MP4 si le téléphone le permet) ou Ajouter aux souvenirs.
- Export vidéo de l'éditeur en MP4 quand c'est possible (plus simple pour WhatsApp).
- Pas de détourage (enlever le fond) : aucun modèle gratuit hors ligne ne garde la moto ; possible plus tard avec un service payant.
- `playlists.sql` exécuté par Elaid le 19/10 (« Success »).

## Version test-16 (19/10)

- **Bibliothèque musicale — playlists** (carte Musique, onglet « Playlists ») : bouton ＋ sur chaque radio, morceau ou lien → ajouter à une playlist perso (sur le téléphone, ex. « Route du dimanche ») ou à la **playlist partagée d'un groupe** (serveur, table `group_tracks` : seuls les membres actifs voient/ajoutent, chacun retire ses ajouts, le chef peut tout retirer). « ▶ Tout lire » enchaîne la playlist. Uniquement des liens (Audius, radios, MP3) : aucun fichier audio n'est stocké sur le serveur.
- Onglets de la carte Musique sur une seule ligne qui défile.

## Version test-15 (19/10)

- **Rallye / course retirés** à la demande d'Elaid (pas de mode compétition ni course dans l'app ; `rallye.sql` supprimé, ne pas l'exécuter).
- Conservé de test-14 : correctif des recherches Musique (radios, morceaux, liens) qui ne se perdent plus quand l'écran se redessine.

## Version test-13 (19/10)

- Carte Musique : nouvel onglet **« Morceaux »** = musique à la demande via le catalogue libre **Audius** (raccourcis Tendances, Raï, Chaabi, Rap, Électro, Rock + recherche titre/artiste ; enchaînement automatique ; ★ pour garder un morceau dans « Mon annuaire »). Appels avec `app_name=MotoRoute` ; si Audius exige une clé, la coller dans `AU_KEY` (clé gratuite sur https://api.audius.co/plans, la clé « API Key », jamais le « Bearer Token »).

## Version test-12 (19/10)

- Carte « Musique » repliée par défaut (une seule ligne avec les commandes, ▾ pour ouvrir), liste plus courte ; mini-lecteur plus fin, placé au-dessus de la bannière publicitaire quand elle est affichée.
- Annonces : les boutons (Contacter, ♡, Noter, Signaler, Supprimer) passent à la ligne au lieu de déborder.

## Version test-11 (19/10)

- **Présentation animée au premier lancement** (`www/presentation.html`) : 9 scènes en 3D (Djurdjura, col de Tikjda, motos), choix Français / العربية, musique générée sans droits, voix off française (Kokoro « siwis », Apache 2.0 / données SIWIS CC BY 4.0) en une seule piste continue, sous-titres. Arabe : sous-titres + musique, **pas de voix** (en attente d'un MP3 en darija, voix de jeune femme algéroise). Bouton « Plus tard », bouton final « Créer mon compte » qui ouvre 🔑. Revoir : aide « ? » → « ▶ Revoir la présentation ».
- **Lecteur musique intégré** (onglet Route, carte « Musique ») : radios en ligne gratuites sans compte (annuaire Radio Browser, raccourcis Algérie, Raï, Chaabi, Kabyle, Rock, Monde + recherche), ★ pour enregistrer dans « Mon annuaire », « Lien » pour lire ou enregistrer une adresse MP3/flux (https), mini-lecteur au-dessus de la barre du bas qui reste quand on change d'onglet, commandes du casque Bluetooth. Seuls les flux https sont proposés.
- Contient aussi le numéro de Simou Cycle (prévu pour test-11).
- À faire plus tard : clé gratuite Audius (morceaux à la demande), playlist du club sur Supabase, lecture écran éteint (module Capacitor de lecture en arrière-plan), voix arabe en darija.

## Version test-10 (18/10, soir)

- **Icônes de la barre du bas** redessinées, plus sobres : route, étiquette, blason (Groupes), boussole, compteur, carnet.
- **Vitrines partenaires** dans Annonces : bouton « Voir la vitrine » (promotions avec prix barré et date de fin, nouveautés, produits, bouton « Je suis intéressé » → WhatsApp avec message prêt), produits « à la une » affichés sur la carte du partenaire.
- **Espace annonceur (démo)** : lien « ⚙ Espace annonceur » sous chaque partenaire → statistiques (vues, clics WhatsApp, appels, itinéraires), « Ma vitrine » (présentation, téléphone, adresse, horaires), « Publier » (promo / produit / nouveauté avec photo), « Aperçu client ».
- Numéro de Simou Cycle (+213 550 31 83 68) inscrit dans l’app, sera inclus dans la prochaine version (test-11).
- Simou Cycle a 6 publications marquées « Exemple » pour la démonstration (bouton « Remettre la démo à zéro »).
- ⚠️ Démo : tout est enregistré sur le téléphone. Pour la vraie version : un compte partenaire sur Supabase (table des vitrines + photos) pour que Simou gère sa vitrine depuis son propre téléphone.

## Fait le 18 octobre 2026

- Supprimer une sortie, un groupe, son compte (serveur + app) ; sorties passées rangées dans un historique
- Clé de signature fixe ; numéro de version automatique
- Icône MotoRoute (route + montagne, or sur fond sombre)
- Écran toujours allumé pendant Conduite et Suivi en direct ; résumé de trajet récupéré si l'app se ferme
- QR de la carte membre correct en mode sombre
- Pages Confidentialité et Suppression de compte (FR / AR / EN), en ligne sur GitHub Pages
- Groupes « sur validation » : le chef accepte ou refuse les demandes
- Publicités AdMob **en mode test** (Annonces, Groupes, Carnet — jamais pendant la conduite) : vérifié sur le téléphone
- « Mot de passe oublié ? » + page pour choisir un nouveau mot de passe — **fonctionne avec Brevo**
- Supabase : Site URL = `https://elaidremili-sudo.github.io/Elaid/`, Redirect URL = `https://elaidremili-sudo.github.io/Elaid/**`
- Nom du partenaire corrigé : **Simou Cycle**
- Fiche Google Play préparée (textes FR/AR/EN, images, formulaire « Sécurité des données »)

## Comptes de test (Supabase)

`elaidremilipro@gmail.com` (compte principal dans l'app), `elaidremili@gmail.com` (chef du groupe « Fd »), `elaidremili@yahoo.fr` (débloqué le 18/10). Les deux comptes Zina appartiennent à quelqu'un d'autre.

## À faire ensuite (mis à jour le 19/10 à 15 h)

**Elaid, à tester sur le téléphone (test-19) :**
1. Éditeur 🎬 : **📷 Photo** ouvre bien l'appareil photo, **🎥 Vidéo** la caméra.
2. Sans compte : l'écran « Bienvenue » bloque l'app et **Quitter** ferme bien l'application.
3. Retouche IA : « Flouter les visages » sur une vraie photo de groupe, puis **Film souvenir** (vitesse de création, son, partage WhatsApp).
4. Playlists : ＋ sur un morceau → playlist perso, puis playlist d'un groupe (le SQL est exécuté).

**Studio IA en ligne (en attente des réponses d'Elaid) :** service fal.ai (paiement à l'usage, crédits prépayés), clé rangée seulement dans les secrets Supabase, crédits par membre (ex. 5/semaine, 1 image = 1, 1 vidéo = 5). Options proposées : détourage, nouveau décor, style, netteté, photo animée (vidéo 5 s), affiche de sortie. Prix indicatifs : ≈ 0,04 $ par image, ≈ 0,25–0,35 $ par vidéo de 5 s. Réponses attendues : (1) budget max par mois, (2) images seules ou aussi vidéos, (3) d'accord pour créer le compte fal.ai. Obligations Google Play : bouton « Signaler » sur les images IA + déclaration « Sécurité des données ».

**Publication Google Play (le plus long) :**
5. **Justificatif d'adresse** pour Google Play (facture ou relevé à son nom, même adresse que le compte) — c'est ce qui bloque tout le reste.
6. **12 testeurs** (adresses Gmail de motards) pour le test fermé obligatoire de 14 jours.
7. **AdMob** : créer le compte et l'app MotoRoute, puis donner à Claude l'ID d'application et l'ID de bannière.
8. Donner à Google un **compte de test** (Play Console → Accès à l'application), car l'app exige un compte.

**Plus tard :**
- Démo Simou Cycle (vitrine) puis vrai compte partenaire sur Supabase si il accepte.
- Clé Audius si les morceaux ne se chargent pas ; lecture écran éteint (module natif) ; voix arabe en darija si Elaid envoie un MP3.
- Feuille de route : lancement auto en Bluetooth, cartes hors ligne, défis et badges (pas de mode course : annulé).

Prochaine fabrication = **test-20**. Les envois qui ne changent que REPRISE.md portent `[skip ci]` pour ne pas fabriquer de version.
