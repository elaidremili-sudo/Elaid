# MotoRoute – Bilan avant finalisation (31/10/2026) — LIRE EN PREMIER

**Règle décidée par Elaid :** à la prochaine reprise, on termine cette liste dans l'ordre avant d'ajouter quoi que ce soit.

## Résumé

- **Dernière version : test-70.** Elle contient le talkie-walkie, les messages vocaux et le direct Cloudflare activé, avec un coupe-circuit qui limite le direct à 300 000 minutes par mois pour le club et à 4 heures par jour et par membre.
- **Audit du 31/10.** 6 agents ont fait le tour de l'application. 3 rapports sont arrivés : écrans (25 constats), sécurité (21 constats, aucun critique), performance et serveur (18 constats). Les 3 autres audits (bugs, Google Play, SOS/talkie/capteurs) n'étaient pas finis à 15 h 55 : leurs tâches seront ajoutées ici dès qu'ils seront terminés.
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
- Le résultat de l'audit Google Play détaillé sera ajouté ici. Déjà connu : 12 testeurs pendant 14 jours de test fermé, fiche Play Console (confidentialité, sécurité des données, déclaration SMS, compte de test pour l'examen, classification), AAB signé, AdMob approuvé.

## Déjà fait (rappel)
- test-67 à test-70 : corrections de l'audit du 26/10, talkie-walkie (messages vocaux et direct), icône talkie, coupe-circuit.
- Serveur : test-67.sql, talkie.sql et talkie-quota.sql appliqués ; fonctions sos-push, delete-account et talkie en ligne ; secrets Cloudflare enregistrés et vérifiés.
