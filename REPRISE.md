# MotoRoute – Point de reprise

**Dernière mise à jour : 18 octobre 2026, 22 h 15.**
Pour reprendre, dis simplement à Claude : « On reprend MotoRoute, lis REPRISE.md dans mon dépôt Elaid ».

## Où tout se trouve

| Quoi | Où |
| --- | --- |
| Code de l'application | dépôt GitHub `elaidremili-sudo/Elaid`, fichier `www/index.html` |
| Version Android à installer | onglet **Releases** du dépôt (dernière : **test-10**) |
| Fichier pour Google Play (.aab) | même release, `MotoRoute-10.aab` |
| Scripts SQL Supabase | dossier `supabase/` (déjà exécutés : `suppression.sql`, `validation-groupes.sql`) |
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

Prochaine fabrication = **test-11** (contiendra le numéro de Simou). Les envois qui ne changent que REPRISE.md portent `[skip ci]` pour ne pas fabriquer de version.
