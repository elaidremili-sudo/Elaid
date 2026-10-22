# MotoRoute – Point du 22 octobre 2026, 10 h 35 (LIRE EN PREMIER, puis REPRISE.md)

Dernière version publiée : **test-46** (aucune version au-delà dans le dépôt ; Elaid pensait être à test-53 → à éclaircir).

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
