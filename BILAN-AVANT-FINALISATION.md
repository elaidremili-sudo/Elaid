# MotoRoute – Bilan avant finalisation (31/10/2026) — LIRE EN PREMIER

> **Point du 31/10, 21 h 30 : test-71.** Fait :
> - A1 à A9, A11, A12 : suivi en direct sans doublon, miniatures photos (400 px, cache 1 an), synchro limitée (30 derniers jours + à venir), capteurs seulement en trajet, SOS rouge fixe en haut de tous les onglets, barre du haut regroupée dans « ☰ Menu » (Mode gants en premier), libellés du mode gants, « + » en arabe, cartes de sortie allégées, aide réécrite (Conduite, Talkie, tutoiement).
> - A5 talkie : comptage toutes les 5 min, 2 ratés = coupure, quota revérifié à la session et à l'écoute. Le téléphone suit le rythme donné par le serveur (compatible avec l'ancienne fonction).
> - **Détection de chute** (retour d'Elaid : un geste de la main la déclenchait) : alerte seulement si la moto roulait (≥ 15 km/h dans les 90 s avant le choc), choc > 4 g, immobilité mesurée après le choc ; vitesse calculée si le téléphone ne la donne pas. Vérifié en simulation (8 scénarios).
> - **Inclinaison** (retour d'Elaid : 46° dans l'app, 37° max sur le tableau de bord de sa Z H2) : calcul corrigé dans www/js/lean.js (angle de la MOTO et non de l'ensemble moto + pilote, lacet autour de la gravité instantanée, lissage avant l'arcsinus). Nouveau banc scripts/banc/banc-realiste.js (retard GPS, freinage, pilote penché, angle MAX) : pire cas 28° vrai → 41° app avant, → 35° maintenant.
> - **Inclinaison colorée déplacée dans Conduite** (www/js/inclinaison.js) : 5 couleurs, virages numérotés, plein écran avec zoom, détail de chaque virage, profil, et réglage « Ma moto affichait un autre angle ? » (coefficient S.leanK).
> - B1 à B9 préparés : supabase/securite-31-10.sql (testé 2 fois sur une base locale, non appliqué) + politique de confidentialité à jour ; app déjà adaptée (code ange gardien protégé + « Changer mon code », sirène SOS anti-spam dans sos-push).
>
> **À faire par Elaid (refusé depuis la session de Claude) :**
> 1. Coller dans le SQL Editor : https://elaidremili-sudo.github.io/Elaid/sql/talkie-quota-v2.html puis https://elaidremili-sudo.github.io/Elaid/sql/securite-31-10.html (si pg_cron est refusé : Database → Extensions → pg_cron, puis relancer).
> 2. Remettre en ligne les fonctions **talkie** et **sos-push** (depuis un PC avec Claude, ou dire « déploie » dans une session qui en a le droit).
> 3. Tester test-71 : secouer le téléphone à la main (aucune alerte), un trajet en virages en comparant avec le tableau de bord, puis « Ma moto affichait un autre angle ? ».
>
> **Décisions en attente :** SOS des nouveaux membres dans les groupes publics ouverts bloqué 24 h (B3) : garder ? Fiche d'urgence : synchroniser de nouveau avec le compte ou la laisser sur le téléphone ? Cases « Partager ma position avec mon groupe » / « Prévenir quand un motard est proche » de Route sans effet : retirer la carte ?
>
> **Reste dans la liste :** A10 (TESTING=false le jour de Google Play), B5 (SMS/appel limités aux numéros d'urgence, module Android), B10 (supprimer fcm-check), puis C, D, E ci-dessous.

**Règle décidée par Elaid :** à la prochaine reprise, on termine cette liste dans l'ordre avant d'ajouter quoi que ce soit.

## Résumé

- **Dernière version : test-70.** Elle contient le talkie-walkie, les messages vocaux et le direct Cloudflare activé, avec un coupe-circuit qui limite le direct à 300 000 minutes par mois pour le club et à 4 heures par jour et par membre.
- **Audit du 31/10.** 6 agents ont fait le tour de l'application. Rapports intégrés : écrans (25 constats), sécurité (21 constats, aucun critique), performance et serveur (18 constats), Google Play (8 points bloquants, 31 à faire). Les audits bugs et SOS/talkie/capteurs seront ajoutés dès qu'ils seront terminés.
- **Ce qui va bien :**
  - les données sont bien protégées sur le serveur (règles d'accès sur toutes les tables, auteur imposé par le serveur) ;
  - aucun secret n'est écrit dans le code ;
  - les écrans vides expliquent quoi faire ;
  - l'arabe s'affiche correctement, à une exception près ;
  - les pubs n'apparaissent jamais pendant la conduite ni pendant un SOS ;
  - le défaut du bouton casque du talkie est corrigé.
- **Point le plus important :** avec 200 membres actifs, l'offre gratuite de Supabase **ne tiendrait pas** avec le code actuel. Les photos affichées en grand et le suivi en direct envoyé en double dépasseraient les limites. Les tâches A1 à A3 règlent ce problème, en quelques heures de travail.

## Tâches restantes (dans l'ordre)

### A. À corriger en premier (Claude, dans le code)
1. **Suivi en direct :** les positions sont reçues deux fois. Garder seulement la relecture toutes les 20 s (`www/index.html` ~1373).
2. **Photos :** créer des miniatures de 400 px à l'envoi pour les listes, et garder les photos plus longtemps en mémoire (`www/js/photos.js:20`, `www/js/annonces.js:75,137`).
3. **Synchronisation des sorties et groupes :** ne télécharger que les sorties récentes et à venir, avec une limite, au lieu de tout l'historique à chaque fois (`www/index.html` ~1013, ~1127).
4. **Capteur de mouvement :** l'allumer seulement pendant un trajet ou quand la détection de chute est activée (`www/index.html` ~770). Réduire aussi les minuteries rapides.
5. **Coupe-circuit Cloudflare :**
   - vérifier aussi le quota quand une session est créée et quand on écoute quelqu'un ;
   - couper le direct après 2 comptages de minutes ratés ;
   - compter toutes les 5 minutes au lieu de chaque minute.
   Ensuite, remettre en ligne la fonction `talkie`.
6. **Arabe :** le bouton « + » prend toute la largeur de l'écran (conflit avec le style Futuriste, une ligne de CSS à corriger).
7. **SOS accessible depuis tous les onglets**, surtout depuis Conduite, avec un bouton fixe en haut.
8. **Mode gants :** les libellés de la barre du bas sont coupés. Rendre aussi le Mode gants plus facile à trouver.
9. **Barre du haut :** il y a 7 boutons emoji de 40 px. Les regrouper et ajouter des libellés.
10. **Pubs :** passer `TESTING=false` avant Google Play (sinon une fenêtre de débogage s'affiche et les limites de pubs sont allégées).
11. Petites corrections d'écran :
    - retirer la phrase de prototype restée dans Route ;
    - traduire « Mon espace » et « Apparence » en anglais ;
    - élargir le bouton « Ajouter » de Mon garage, qui est tronqué ;
    - améliorer les contrastes faibles (Mes urgences, carte membre, « ← Retour ») ;
    - alléger les cartes de sortie (jusqu'à 8 boutons) ;
    - fusionner les doublons d'Annonces (2 boutons pour publier, 2 filtres « Tout ») ;
    - remonter le talkie plus haut dans Conduite ;
    - passer les boutons à 48 px et agrandir les cases à cocher ;
    - corriger « 1 participants » et la flèche « → » non retournée en arabe.
12. **Mettre à jour l'aide** (« Comment ça marche ? ») : ajouter Conduite et le Talkie-walkie, retirer l'envoi par WhatsApp, et choisir entre tutoiement et vouvoiement.

### B. Sécurité et confidentialité (Claude)
1. **Politique de confidentialité :** ajouter le talkie (voix gardée 24 h, direct par Cloudflare, micro en arrière-plan). Corriger aussi la fiche d'urgence : elle est **stockée sur le serveur** (groupe sanguin, allergies), alors que la politique dit le contraire. Il faut choisir : la garder seulement sur le téléphone, ou l'assumer dans la politique.
2. **Prénom imposé par le serveur** dans la discussion de groupe, la carte en direct et l'indication « X parle » du talkie (aujourd'hui, un membre peut se faire passer pour un autre).
3. **Limiter le spam de sirène SOS** dans les groupes publics (par exemple : membre depuis plus de 24 h, ou groupe sur validation).
4. **Limiter le nombre d'envois** de photos et de messages vocaux par membre.
5. **Modules Android SMS et appel :** n'accepter que les numéros d'urgence enregistrés.
6. **Code ange gardien :** limiter le nombre d'essais et permettre de le changer.
7. **Effacements automatiques promis** (positions après 8 h, alertes après 7 jours) : les faire réellement côté serveur. Purger aussi les annonces expirées et leurs photos.
8. **Lien WhatsApp des groupes :** le contrôler aussi côté serveur, pas seulement dans l'app.
9. **Script SQL d'optimisation :** recalculer moins souvent l'identité du membre dans les règles d'accès (51 alertes du conseiller Supabase), et ajouter 14 index manquants.
10. **Supprimer la fonction temporaire `fcm-check`**, qui est toujours en ligne.

### C. À faire par Elaid (consoles)
1. **Régénérer le jeton Cloudflare** (il a été montré dans la conversation) et la **clé Firebase**. Le dépôt GitHub est **public**.
2. **Cloudflare :** créer une alerte budget à 1 $ (Billing → Billable Usage).
3. **Supabase Auth :** rendre la confirmation par e-mail obligatoire et activer un CAPTCHA à l'inscription.
4. **Supabase Realtime :** couper l'accès public aux canaux (Settings), pour ne garder que les canaux privés.
5. **Google Cloud :** vérifier que la clé Android est bien limitée à com.motoroute.app.
6. **Google Play :** l'autorisation `SEND_SMS` devra être déclarée. Préparer la justification « SOS après chute ». La réponse de Google est incertaine.

### D. Tests sur les 2 téléphones (Elaid, après les corrections A)
1. **Talkie en direct** (2 comptes du même groupe, Conduite → Rejoindre) : le point turquoise « Direct » doit s'afficher et on doit s'entendre pendant qu'on parle.
2. **Messages vocaux**, puis le bouton du casque Bluetooth, puis l'écran éteint.
3. **SOS :** bouton rouge, Mes urgences, SOS avec le réseau coupé puis rétabli (la sirène doit sonner une seule fois).
4. **test-67 :** sortie « Sportif », groupe avec une ville, suppression d'un compte de test.
5. **Sur la moto :** inclinaison, résumé du trajet, musique écran éteint, absence de fausse alerte de chute.

### E. Publication Google Play (en dernier)
**Déjà en ordre :** Android 16 (API 36) visé, AAB signé (version 170), autorisations refusées retirées, pas de localisation en arrière-plan, suppression du compte qui marche, bannière conforme.

**BLOQUANT – Claude (code) :**
1. Politique de confidentialité : ajouter le talkie (voix, messages vocaux gardés 24 h, Cloudflare). La page dit encore que le micro ne sert qu'à filmer. *(Même tâche que B1.)*
2. **Conditions d'utilisation** à créer, et à faire accepter avant toute publication par un membre.
3. **Signaler et bloquer** : pouvoir signaler un message de la discussion de groupe et bloquer un membre.
4. **Avertissement avant la demande d'accès au micro** : un texte qui explique à quoi sert le micro, affiché avant la fenêtre d'Android.

**BLOQUANT – Elaid (console Play), avec l'aide de Claude :**
5. **Compte de test** réservé à l'équipe d'examen de Google.
6. Formulaire **« Sécurité des données »** à refaire. Il faut déclarer la voix, le groupe sanguin, les messages, les photos et l'identifiant publicitaire. Claude prépare la grille.
7. **Déclaration SMS** : c'est le point le plus risqué. Google accepte l'envoi automatique de SMS seulement au cas par cas, au titre des « alertes d'urgence ». Prévoir un plan B : SMS prérempli, que le motard envoie lui-même, ou SMS envoyé par un serveur.
8. **Services qui tournent écran éteint** (musique, micro du talkie) : à déclarer, avec 2 vidéos de démonstration à filmer.
9. Dès le premier envoi : ajouter dans Firebase les **empreintes de la clé de signature de Google**. Sans ça, la sirène SOS ne marchera pas chez les testeurs.

**À FAIRE aussi :**
- Refaire les 5 captures d'écran sur test-70.
- Refaire l'icône 512 px en PNG avec transparence.
- Déclarations « applis de santé » et « fonctions financières », obligatoires pour toutes les applis.
- Créer le fichier **app-ads.txt** : il faut un dépôt GitHub `elaidremili-sudo.github.io`.
- Supprimer le vieux code AdMob de `scripts/patch-android.js` (variables ADMOB_*), qui ne sert plus.
- Passer `TESTING=false` le jour de la production. AdMob n'examinera l'app qu'une fois publique.
- Prévenir les testeurs : ils devront **désinstaller l'APK** avant d'installer la version Play, et ils perdront le carnet, la fiche d'urgence et les souvenirs gardés seulement sur le téléphone.
- Ne jamais relancer une fabrication GitHub telle quelle : elle garde le même numéro de version, et Google le refuserait. Toujours repartir d'un nouvel envoi de code.
- Ensuite : 12 testeurs pendant 14 jours d'affilée, puis demande de production (réponse en 7 jours ou moins).
- Europe : un module de consentement AdMob serait nécessaire. Si l'app est diffusée en Algérie seulement, rien à faire.

## Déjà fait (rappel)
- test-67 à test-70 : corrections de l'audit du 26/10, talkie-walkie (messages vocaux et direct), icône talkie, coupe-circuit.
- Serveur : test-67.sql, talkie.sql et talkie-quota.sql appliqués ; fonctions sos-push, delete-account et talkie en ligne ; secrets Cloudflare enregistrés et vérifiés.
