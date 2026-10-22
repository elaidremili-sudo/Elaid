# MotoRoute – Point du 22 octobre 2026, 10 h 35 (LIRE EN PREMIER, puis REPRISE.md)

Dernière version publiée : **test-46** (aucune version au-delà dans le dépôt ; Elaid pensait être à test-53 → à éclaircir).

## 🔧 Soir du 22/10 (18 h 30) – version test-47
- **Sirène app fermée** : le serveur envoie maintenant un message « données seules » prioritaire ; le service Android MrSosService le reçoit même app fermée et MrSirenService joue la sirène sur le canal ALARME (sonne aussi en silencieux), 24 s, puis lit le message 2 fois. Bouton « Arrêter la sirène », toucher l'alerte ouvre la position. ⚠️ Les DEUX téléphones doivent avoir test-47 (test-46 n'affiche plus rien app fermée).
- **« Je ne reçois pas les alertes »** : côté serveur, Google a accepté les 4 envois d'Ali vers Elaid (8 h 26-8 h 28) → le blocage était sur le téléphone. Carte « anges gardiens » : nouvel état « Ce téléphone peut recevoir la sirène » + boutons Autoriser / batterie « Sans restriction ».
- **Inclinaison** : le GPS décide s'il y a virage (cap du GPS, mesure sur 2 s, médianes), le gyroscope affine ; formule corrigée (atan au lieu de asin, qui exagérait : 41° au lieu de 33°) ; message « Le téléphone bouge » si tenu en main. Simulation : autoroute 127 km/h téléphone en main 47° max → 12° max (moyenne 1°), virages justes (16° et 33° attendus → 16-17° et 33°).
- **Présentation** : clé « déjà vue » versionnée (se remontre une fois), sauvegarde Android coupée, Sentry prévenu si elle ne s'affiche pas.

## 🏍 Inclinaison – test-50 (22/10, 20 h)
Méthode des études (TU Darmstadt/IFZ 2020 : erreur ~2° au téléphone ; Schlipsing 2012) : roulis du gyroscope intégré + angle d'équilibre sin(angle) = vitesse × lacet (repère moto) / g, filtre complémentaire 1,2 s ; axe avant appris tout seul et mémorisé (effacé au recalibrage). Corrige 2 erreurs de test-47 : atan au lieu de asin (sous-estimait) et plafond GPS appliqué même téléphone fixé (rabotait les virages). Plafond GPS seulement si le téléphone bouge.
Simulation col (virages 13-30 m/s) : test-46 2,9° d'erreur (20° en ligne droite), test-49 11,5°, test-50 1,9° (95 % < 4,5°), téléphone monté de travers idem.

## ✅ Nouveau
- **Compte Google Play Console VALIDÉ** (justificatif d'adresse accepté, numéro de téléphone vérifié). Plus rien ne bloque côté compte.

## ❌ À corriger
- **Sirène ange gardien** : selon Elaid, l'alerte n'arrive toujours pas sur l'autre téléphone. Vérifier que test-46 est installée sur LES DEUX téléphones, refaire « 🔔 Tester la sirène chez eux » et lire l'erreur exacte affichée (champ errors de sos-push).
- **Inclinaison instable** (vidéo d'Elaid en voiture, autoroute, 127 km/h, téléphone tenu en main) : 0 → 30° en ligne droite. Cause probable : l'exception « virage franc et régulier au gyroscope » laisse passer les rotations de la main, multipliées par la vitesse. À faire : le GPS décide s'il y a virage, le gyroscope sert seulement à affiner, lissage, message « téléphone pas fixé » si le téléphone bouge sans virage GPS.
- **Présentation d'entrée absente sur les autres téléphones** : la test-42 ne l'a PAS retirée (vérifié dans le diff : seuls le bouton « Voir une simulation » et replay3d.js ont été enlevés). Testée le 22/10 en navigateur mobile vierge sur test-46 : elle s'ouvre bien. Cause probable : clé localStorage « mr_onb_seen » mémorisée (survit aux mises à jour et, via la sauvegarde Android, aux réinstallations). À faire en test-47 : clé versionnée (la remontrer une fois après la mise à jour), exclure de la sauvegarde Android, signaler à Sentry si elle ne démarre pas. Test rapide : aide « ? » → « ▶ Revoir la présentation ».

## 🛒 Google Play – prochaines étapes (dans l'ordre)
1. Réunir **12 testeurs minimum** (viser 15-20, adresses Gmail) : test fermé de **14 jours d'affilée** obligatoire pour un compte personnel.
2. Version **AAB** signée : déjà fabriquée à chaque version (fichier MotoRoute-NN.aab dans l'onglet Releases, à côté de l'APK) → rien à faire, il suffit de l'envoyer dans la Play Console (Tests → Test fermé).
3. Fiche Play Console : politique de confidentialité, sécurité des données, **déclaration SMS** (alertes d'urgence), compte de test, classification du contenu.
4. Compte **AdMob** → envoyer les identifiants application + bannière.
5. Lancer le test fermé, partager le lien ; après 14 jours → demande d'accès à la production.

## Autres restes
- Tests à 2 téléphones : groupe « Sur validation », Comparer → Membres.
- Démo de l'espace annonceur à Simou Cycle ; retour de l'ami iPhone.
- Supabase : supprimer la fonction fcm-check ; régénérer la clé Firebase vue sur des captures.
