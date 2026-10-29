# MotoRoute – Point du 29 octobre 2026 (test-67) — LIRE EN PREMIER

> **Point de reprise 29/10, 14 h 30 (demandé par Elaid, suite la prochaine fois)**
> - ✅ **test-67 publiée** (APK + AAB signés, onglet Releases) : fabrication réussie avec API 36, contrôle Google Play passé.
> - ⚠️ **SQL `supabase/test-67.sql` PAS encore appliqué** : l'application par Claude via le connecteur Supabase a été annulée 4 fois (même après accord d'Elaid) → **Elaid doit le coller dans Supabase → SQL Editor → Run**. L'app test-67 marche quand même avec l'ancien serveur.
> - ⏳ Après le SQL seulement : Claude déploie les fonctions `sos-push` puis `delete-account` (verify JWT).
> - 🚧 **Talkie-walkie (test-68) en cours sur la branche `test-68-en-cours`** (pas sur main) :
>   - ✅ Partie Android faite (scripts/patch-android.js : plugin `MrTalkie` start/stop/isRunning/state, service au premier plan `MrTalkieService` type microphone, notification Parler/Arrêter, bouton du casque = parler, 30 s max, coupure si appel) + contrôle du workflow (RECORD_AUDIO, FOREGROUND_SERVICE_MICROPHONE) + `play-store/declaration-micro-talkie.md`. Non compilé (pas de SDK ici), à valider par le build GitHub.
>   - 🚧 Partie app + serveur en cours (www/js/talkie.js, carte talkie dans Conduite/groupes/sorties, supabase/talkie.sql, fonction `talkie` pour Cloudflare, section audio de la confidentialité). Contrat : la page expose `window.MrTalkie.pttDown/pttUp/toggle` ; sur l'événement `mr-talkie-native` type `button`, le natif appelle lui-même `toggle()` (ne pas le refaire) ; types `timeout`/`focus` → `pttUp()` ; `stop` → fermer micro/réseau ; envoyer `state({receiving})` pendant la lecture.
>   - Reste : finir/relire l'app, test navigateur à 2 membres, build test-68, test sur téléphone (Android 14+, casque, écran éteint), compte Cloudflare + app Realtime + secrets Supabase (Elaid), SQL talkie à appliquer.
> - Toujours à faire par Elaid : régénérer la clé du compte de service Firebase.

## Ce qui est dans test-67
Corrections de l'audit du 26-10 (6 agents), faites par 3 agents puis relues par Claude.

**Google Play**
- Cible Android API 36 (scripts/patch-android.js : compileSdk/targetSdk 36, AGP 8.10.1, Gradle 8.11.1).
- Autorisations retirées : READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_PHONE_STATE (nom de la SIM obtenu sans autorisation, peut être vide).
- La fabrication échoue d'elle-même si la cible n'est pas 36 ou si une de ces autorisations revient (contrôle aapt2 dans .github/workflows/android.yml).
- Pages docs/confidentialite.html et docs/suppression-compte.html réécrites (FR/AR/EN) : ce qui est réellement envoyé au serveur, photos effacées avec le compte.

**SOS**
- File d'attente persistante (www/js/sos.js, window.MrSosQueue) : alerte groupe + sirène renvoyées quand le réseau revient (5 s, 15 s, 30 s puis chaque minute, 2 h max), sans doublon (client_id). Le SMS part toujours tout de suite.
- Bouton « ❌ Fausse alerte – annuler l'envoi » et « Je vais bien » vident la file (window.mrSosCancel).
- Échecs signalés à Sentry.

**Écrans**
- Bouton SOS rouge, 76 px, tout en haut de Route.
- Écran unique « 🆘 Mes urgences » (fiche, numéro SOS, SMS/appel auto, anges gardiens), ouvert depuis Mon espace, la carte SOS, Détection de chute.
- Niveau des sorties envoyé en easy / intermediate / sporty (contrainte réelle de la base) ; anciennes valeurs encore lues.
- Fausses sorties/groupes/annonces de démo supprimés (et nettoyés sur les téléphones) ; ligne de débogage « Capteurs » et phrases de prototype retirées.
- Batterie : vidéos et animations coupées pendant un trajet ; position en direct envoyée toutes les 15 s ; sauvegarde du trajet toutes les 15 s.
- Boutons ≥ 48 px (gants) ; messages d'erreur du serveur traduits FR/AR/EN.
- Suppression du compte : passe par la fonction serveur delete-account (efface aussi les photos) ; si elle n'est pas encore en ligne, repli sur l'ancienne suppression.

## ⚠️ À FAIRE (dans cet ordre)
1. **Elaid** : coller `supabase/test-67.sql` dans Supabase → SQL Editor → Run (l'application automatique par Claude a été annulée le 29/10). Ajoute aussi la colonne `groups.city`.
2. **Claude, après l'étape 1 seulement** : déployer les fonctions `sos-push` (nouvelle version, utilise sos_push_log.client_id) puis `delete-account` (verify JWT activé). Ne PAS déployer sos-push avant le SQL.
3. **Elaid** : installer test-67, tester : SOS (bouton rouge, Mes urgences), SOS réseau coupé puis rétabli (2 téléphones), création de sortie « Sportif », création de groupe avec ville, trajet en Conduite (batterie), SMS de test (nom de SIM peut être vide), affichage plein écran Android 15/16.
4. **Elaid** : régénérer la clé du compte de service Firebase (~20 min, guidé).
5. Si la fabrication GitHub échoue sur AGP 8.10.1 : passer à AGP 8.13.0 + Gradle 8.14.3.

## Prévu pour plus tard (décidé le 29/10)
**Talkie-walkie de groupe (push-to-talk)** pour les membres sans casque intercom :
- Vrai direct via **Cloudflare Realtime** (SFU, 1 000 Go/mois gratuits puis 0,05 $/Go) ; groupes, droits et jetons via Supabase (Edge Function, la clé Cloudflare ne va jamais dans l'app).
- Repli automatique en **messages vocaux instantanés** (Supabase Storage + Realtime) quand le réseau est faible.
- Bouton du casque Bluetooth pour parler, écran éteint, bip + prénom de celui qui parle, un seul à la fois.
- Elaid devra créer un compte Cloudflare + une app Realtime et mettre le jeton en secret Supabase.
- Écartés : Agora (10 000 min/mois, compte chaque minute connectée), LiveKit (1 000 min), Oracle Cloud gratuit (création difficile, carte demandée) gardé en plan B.
