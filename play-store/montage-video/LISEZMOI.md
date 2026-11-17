# Montage de la vidéo de démonstration SMS (Google Play)

Scripts utilisés les 16 et 17/11 pour la vidéo `motoroute-demo-sms-v8.mp4` (hors dépôt, 15 Mo, envoyée à Elaid).
Les vidéos ne sont pas dans le dépôt : seulement les scripts, pour refaire le montage.

- `build.py` / `build_nocap.py` + `ocr.py` : découpe des enregistrements bruts de l'étape 1 et floutage automatique
  (OCR tesseract en 3 passes : normal, luminosité ×3, ×8 ; numéros ≥ 3 chiffres, e-mails, noms).
- `head.py` + `P.json` : en-tête du style du montage d'origine (badge « STEP 1 OF 9 », titre, sous-titre ; polices Inter).
- `compose.py` : place l'écran du téléphone dans le gabarit (218,410, 644×1438, coins arrondis), sous-titres, coupes,
  images figées, flou des images en mouvement → `etape1-v4style.mp4` (38,3 s).
- `blur_old.py` : floutage OCR de l'ancienne partie en français (noms, numéros ; GPS gardé volontairement).
- `find_al.py` + `apply_al.py`, `fix_al2.py`, `fix_v8.py` : corrections des fuites trouvées par les relecteurs
  (début de nom « Al », « L » et avatars dans Messages, avatar « E » et étiquette « Travail » dans Maps).

Assemblage final : début du montage d'origine (1,6 s) → fondu 0,5 s → étape 1 → fondu 0,5 s à 38,9 s → ancienne partie.
**L'étape 1 à garder = v8 de 0 à 38,9 s.** Le reste (étapes 2 à 9) est à remplacer par le nouveau tournage
(plan dans `../declaration-sms.md`, section 3).
