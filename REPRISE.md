# MotoRoute – Point de reprise

**Dernière mise à jour : 19 octobre 2026, 10 h 30.**
Pour reprendre, dis simplement à Claude : « On reprend MotoRoute, lis REPRISE.md dans mon dépôt Elaid ».

## Où tout se trouve

| Quoi | Où |
| --- | --- |
| Code de l'application | dépôt GitHub `elaidremili-sudo/Elaid`, fichier `www/index.html` |
| Version Android à installer | onglet **Releases** du dépôt (dernière : **test-14**) |
| Fichier pour Google Play (.aab) | même release, `MotoRoute-14.aab` |
| Présentation animée | `www/presentation.html` (+ `www/lib/three.min.js`) |
| Scripts SQL Supabase | dossier `supabase/` (déjà exécutés : `suppression.sql`, `validation-groupes.sql` ; **à exécuter : `rallye.sql`**) |
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

## Version test-14 (19/10)

- **Rallye de régularité** (onglet Conduite, carte 🏁) : compétition légale entre motards. L'organisateur fixe départ, arrivée (sa position ou lien Google Maps), moyenne imposée (30–80 km/h) et vitesse maximale. Les motards s'inscrivent au tableau avec un code (RR-XXXX, partage WhatsApp). « Je suis au départ » : le chrono démarre tout seul quand la moto roule près du départ et s'arrête tout seul à l'arrivée. Classement = plus petit écart au temps idéal, + 10 s de pénalité par seconde au-dessus de la vitesse max. Stats de chacun : temps, moyenne, max, inclinaison (si calibré dans Conduite), fluidité. Badges : 🏆 le plus régulier, 🌊 le plus fluide, 🛡 zéro dépassement.
- ⚠️ **À faire par Elaid** : exécuter `supabase/rallye.sql` dans Supabase (SQL Editor) avant d'essayer.
- Correctif : les recherches Musique et le formulaire du rallye ne se perdent plus quand l'écran se redessine.
- Prochaine étape envisagée : mode circuit fermé verrouillé par GPS (circuits validés par l'admin) + déclaration de responsabilité acceptée et horodatée.

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

## À faire ensuite (ordre conseillé, mis à jour le 18/10 à 22 h 15)

**Elaid, rapidement :**
1. Installer **test-10** et tester : vitrine Simou, ajout d'une photo dans « Publier », bouton « Je suis intéressé » → WhatsApp, compteur des statistiques.
2. Tester **« Sur validation »** avec deux comptes (créer le groupe en cochant « Sur validation », demander à rejoindre avec l'autre compte, accepter).
3. **Montrer la démo à Simou** (avec test-10 : mettre son numéro dans ⚙ Espace annonceur → Ma vitrine ; il est déjà inscrit dans le code pour test-11).

**Publication Google Play (le plus long) :**
4. **Justificatif d'adresse** pour Google Play (facture ou relevé à son nom, même adresse que le compte) — c'est ce qui bloque tout le reste.
5. **12 testeurs** (adresses Gmail de motards) pour le test fermé obligatoire de 14 jours — commencer à les rassembler.
6. **AdMob** : créer le compte et l'app MotoRoute, puis donner à Claude l'ID d'application et l'ID de bannière.

**Claude, quand Elaid le demande :**
7. Si Simou accepte : vrai **compte partenaire** sur Supabase (vitrine + photos sur le serveur).
8. Feuille de route : lancement auto en Bluetooth, lecteur de musique intégré, cartes hors ligne, défis et badges.

Prochaine fabrication = **test-15**. Les envois qui ne changent que REPRISE.md portent `[skip ci]` pour ne pas fabriquer de version.
