# MotoRoute – Grille « Sécurité des données » (Google Play Console)

Préparée le 05/11/2026 à partir de la politique de confidentialité (docs/confidentialite.html, version du 5 novembre 2026).
Où la remplir : Play Console → MotoRoute → **Contenu de l'appli → Sécurité des données**.
À relire par Elaid avant d'envoyer : c'est lui qui déclare, Google peut refuser l'appli si la déclaration ne correspond pas au comportement réel.

## 1. Questions générales

> Mis à jour le 12/11/2026 (test-105) : groupe sanguin et allergies seulement avec accord exprès (case non cochée par défaut) ; contact d'urgence prévenu ; plus de SMS automatique après une fausse alerte. Politique du 12 novembre 2026.
>
> Mis à jour le 07/11/2026 après l'audit : position précise et nom « partagés » (SMS d'urgence), et données collectées par AdMob (position approximative, interactions, diagnostics). Source AdMob : https://developers.google.com/admob/android/privacy/play-data-disclosure

| Question | Réponse |
|---|---|
| L'appli collecte ou partage-t-elle des données utilisateur ? | **Oui** |
| Toutes les données sont-elles chiffrées en transit ? | **Oui** (HTTPS partout : Supabase, Firebase, Cloudflare, Sentry, AdMob) |
| Les utilisateurs peuvent-ils demander la suppression de leurs données ? | **Oui** : bouton 🔑 → Supprimer mon compte, et page https://elaidremili-sudo.github.io/Elaid/suppression-compte.html |
| Lien de la politique de confidentialité | https://elaidremili-sudo.github.io/Elaid/confidentialite.html |

## 2. Types de données (cocher ceux-ci, rien d'autre)

« Partagée » = transmise à un tiers qui l'utilise pour lui-même (ici seulement Google AdMob). Les prestataires qui travaillent pour nous (Supabase, Firebase, Cloudflare, Brevo, Sentry) **ne comptent pas comme partage** selon Google.
Le nom, la position et le groupe sanguin sont aussi cochés « partagés » par prudence, parce qu'ils partent par SMS vers le contact d'urgence (une personne tierce).

| Catégorie Play | Type | Collectée | Partagée | Obligatoire ? | Pourquoi (cases Play) |
|---|---|---|---|---|---|
| Position | **Position précise** | Oui | **Oui** (07/11 : part dans le SMS d'urgence et l'alerte aux groupes, comme le groupe sanguin) | Facultative | Fonctionnalités de l'appli (partage au groupe, sortie en direct, SOS, bonnes adresses) |
| Position | **Position approximative** | Oui | **Oui (AdMob)** | Facultative | Fonctionnalités de l'appli (option « Position approximative ~2 km ») ; Publicité (AdMob la déduit de l'adresse IP) |
| Infos personnelles | **Nom** (prénom ; nom complet de la fiche d'urgence) | Oui | **Oui** (07/11 : le nom part dans le SMS d'urgence) | Obligatoire (prénom) | Fonctionnalités de l'appli, Gestion du compte |
| Infos personnelles | **Adresse e-mail** | Oui | Non | Obligatoire | Gestion du compte |
| Infos personnelles | **Numéro de téléphone** (annonces, bonnes adresses, contact d'urgence — une autre personne, que le motard doit avoir prévenue : case « J'ai prévenu ce contact ») | Oui | Non | Facultative | Fonctionnalités de l'appli |
| Infos personnelles | **ID utilisateur** (identifiant de compte) | Oui | Non | Obligatoire | Fonctionnalités de l'appli, Gestion du compte, Prévention des fraudes et sécurité (signalements, limites anti-abus) |
| Santé et remise en forme | **Informations de santé** (groupe sanguin, allergies, fiche d'urgence) | Oui, **seulement avec l'accord exprès** du motard (12/11 : case non cochée par défaut ; sans elle, rien n'est envoyé au serveur) | **Oui, seulement avec cet accord** (le groupe sanguin part dans le SMS d'urgence, l'alerte aux groupes et le message WhatsApp que le motard envoie lui-même ; les allergies ne sont jamais partagées) | Facultative | Fonctionnalités de l'appli (SOS) |
| Messages | **Autres messages dans l'appli** (discussion de groupe) | Oui | Non | Facultative | Fonctionnalités de l'appli |
| Photos et vidéos | **Photos** (annonces, bonnes adresses, vitrines) | Oui | Non | Facultative | Fonctionnalités de l'appli |
| Fichiers audio | **Enregistrements vocaux ou sonores** (messages vocaux du talkie, 24 h) | Oui | Non | Facultative | Fonctionnalités de l'appli |
| Activité dans l'appli | **Autre contenu généré par l'utilisateur** (sorties, annonces, bonnes adresses, playlists, signalements) | Oui | Non | Facultative | Fonctionnalités de l'appli |
| Activité dans l'appli | **Interactions avec l'appli** (clics sur les vitrines partenaires, comptés pour les statistiques) | Oui | **Oui (AdMob)** | Facultative | Analyse ; Publicité (AdMob mesure les interactions avec les annonces) |
| Infos et performances de l'appli | **Journaux de plantage** (Sentry) | Oui | Non | Obligatoire | Analyse |
| Infos et performances de l'appli | **Diagnostics** (modèle de téléphone, version, Sentry) | Oui | **Oui (AdMob)** | Obligatoire | Analyse ; Publicité (AdMob collecte des diagnostics) |
| Identifiants de l'appareil ou autres | **ID d'appareil ou autres** (identifiant publicitaire AdMob, jeton Firebase) | Oui | **Oui (AdMob)** | Obligatoire | Publicité ou marketing (AdMob) ; Fonctionnalités de l'appli (jeton de notification SOS) |

**Ne pas cocher** : infos financières, contacts du carnet d'adresses (l'appli ne lit pas le carnet, les numéros sont saisis à la main), SMS lus (l'appli n'en lit aucun), historique web, calendrier, fichiers et documents, vidéos envoyées (les vidéos de l'éditeur restent sur le téléphone).

**Données traitées seulement sur le téléphone** (pas à déclarer) : tracés et statistiques de conduite (sauf « Partager mes trajets » qui est couvert par Position précise), carnet de route, souvenirs, retouche photo.

**Données éphémères** : la voix en direct du talkie (Cloudflare) n'est pas enregistrée → Google permet de la déclarer comme « traitée de façon éphémère » ; les **messages vocaux** sont stockés 24 h, donc déclarés normalement.

## 3. Points d'attention

- Si AdMob n'est pas encore activé en production (`TESTING=true`), garder quand même la ligne « ID d'appareil – partagée » : le SDK AdMob est dans l'appli.
- Cohérence vérifiée le 12/11 avec `declaration-sms.md` et la politique du 12 novembre 2026 : santé = facultative, collectée et partagée seulement avec accord exprès ; aucun SMS automatique hors alerte de chute (SMS de test déclenché par le motard, marqué TEST).
- La déclaration doit rester cohérente avec la **déclaration d'autorisation SMS** et la **déclaration santé** (formulaire séparé « Applis de santé » : répondre que l'appli n'est pas une appli médicale mais contient une fiche d'urgence facultative).
- Voir aussi `play-store/declaration-micro-talkie.md` (micro en arrière-plan, vidéo à fournir).
