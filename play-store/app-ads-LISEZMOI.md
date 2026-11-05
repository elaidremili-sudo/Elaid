# app-ads.txt (AdMob) – à mettre en ligne

AdMob vérifie le fichier `app-ads.txt` **à la racine du site** indiqué comme « Site Web du développeur » dans la fiche Google Play.
Le site actuel (https://elaidremili-sudo.github.io/Elaid/) est un sous-dossier : AdMob ne le lit pas là.

1. Sur GitHub, créer un dépôt **public** nommé exactement `elaidremili-sudo.github.io`.
2. Y mettre le fichier `app-ads.txt` de ce dossier (une seule ligne, identifiant éditeur pub-9115324413258436).
3. Settings → Pages → branche `main`, dossier `/ (root)`.
4. Vérifier que https://elaidremili-sudo.github.io/app-ads.txt affiche la ligne.
5. Play Console → Fiche principale → Coordonnées : Site Web = `https://elaidremili-sudo.github.io`.
6. AdMob → Applications → MotoRoute → app-ads.txt → « Rechercher les mises à jour » (24 h environ).
