# MotoRoute – Point du 25 octobre 2026 (LIRE EN PREMIER, puis POINT-24-10.md et REPRISE.md)

## test-66 — inclinaison fiable malgré les vibrations + musique en arrière-plan

### Retours d'Elaid à l'origine
- Sur le support de la moto, l'app affichait sans arrêt « le téléphone bouge » (vibrations moteur, vent, route abîmée).
- L'inclinaison n'était pas assez juste / stable.
- La musique doit continuer en roulant (écran éteint) et se piloter depuis le casque.

### Inclinaison (nouveau fichier `www/js/lean.js`)
- **Filtre anti-vibrations** : gyroscope (3 Hz) et accéléromètre (2 Hz) filtrés avant tout calcul.
- **Axe de roulis** : appris aux accélérations/freinages en ligne droite (l'accéléromètre penche vers l'avant, le GPS donne
  le sens) ; la covariance avec le virage ne sert plus qu'à confirmer le sens. Fini le mélange avec le tangage
  (5 à 8° de trop en virage serré).
- **Ancrage GPS** : ligne droite vue par le GPS ET par le gyroscope → retour doux à 0°.
- **« Téléphone qui bouge »** : reconnu par la dispersion de la gravité apparente (quasi nulle sur un support, même en virage)
  pendant au moins 0,8 s, hors freinage. **Plus aucune alerte pendant le trajet** : un seul conseil dans le résumé
  (téléphone qui a bougé ≥ 15 % du temps, ou support qui vibre beaucoup → conseil amortisseur pour protéger la caméra).
- **Réglage** dans Conduite : sensibilité Faible / Normale / Forte (`S.vibSens`).
- Valeur affichée = médiane des 0,4 dernières secondes.

**Banc d'essai** (`scripts/banc/`, `node scripts/banc/comparer.js`) : trajets simulés (physique moto, support portrait / paysage
/ penché, vibrations 11-37 Hz, route abîmée, GPS 1 Hz bruité, sans cap, capteurs 60 ou 100 Hz, voiture, téléphone en main),
moyenne de 5 réalisations, ancien (test-65) → nouveau (test-66) :

| Trajet simulé | Erreur moyenne en virage | Pire écart en ligne droite | Alerte « téléphone bouge » |
|---|---|---|---|
| Support, route lisse | 1,2° → 0,9° | 11° → 7° | 0 % → 0 % |
| Support, fortes vibrations | 12,6° → 2,2° | 33° → 12° | 53 % → 0 % |
| Vibrations + route abîmée | 15,3° → 3,2° | 31° → 19° | 55 % → 0 % |
| Paysage, vibrations | 9,5° → 2,0° | 34° → 12° | 48 % → 0 % |
| Support penché, vibrations | 10,0° → 2,3° | 30° → 10° | 44 % → 0 % |
| GPS sans cap, vibrations | 12,2° → 2,1° | 31° → 9° | 41 % → 0 % |
| Capteurs 100 Hz, vibrations | 12,1° → 1,8° | 31° → 9° | 60 % → 0 % |
| Voiture, support | 1,9° → 2,4° | 15° → 15° | 1 % → 0 % |
| Voiture, téléphone en main | 6,8° → 7,0° | 30° → 25° | 73 % → 75 % (bien reconnu) |

Rappel : en dessous de 5°, l'écran affiche 0°. En voiture l'angle affiché n'est qu'une équivalence (la voiture ne penche pas).

### Détection de chute (vibrations)
- Un nid-de-poule (> 3 g) suivi d'un arrêt au feu déclenchait la chute. Maintenant il faut aussi : téléphone basculé de plus de 35°
  par rapport à avant le choc (moto couchée, téléphone éjecté) ou choc énorme (> 6 g), et le GPS ne doit plus voir la moto rouler.
- Corrigé aussi : les Chrome/WebView récents ont `DeviceMotionEvent.requestPermission` ; la détection de chute ne redémarrait
  plus toute seule à l'ouverture de l'appli (il fallait décocher/recocher).
- Vérifié dans l'appli (navigateur de test) : nid-de-poule + arrêt → pas d'alerte ; chute moto couchée → alerte.

### Musique
- Service Android `MrMusicService` (type « lecture multimédia ») + module `MrMusic` (`scripts/patch-android.js`) :
  la musique continue écran éteint / appli en arrière-plan, notification ⏮ ⏯ ⏭ ✕, **boutons du casque Bluetooth / intercom**
  (session média), arrêt automatique après 10 min en pause, arrêt si l'appli est balayée.
- Lecteur (`www/index.html`) : un morceau qui ne répond pas → relance une fois puis passe au suivant ; radio en direct coupée →
  reconnexion automatique ; message clair si une radio ne répond pas.
- Audius : écoute sans clé possible (clé gratuite facultative = plus de requêtes ; 500 000/mois en offre gratuite).
  Jamendo écarté : gratuit seulement pour un usage non commercial (l'app a de la pub AdMob).
- Vérifié dans le navigateur de test (module Android simulé) : flux cassé → suivant, casque suivant/pause/lecture, radio,
  reconnexion, « Fermer ».

### À tester par Elaid sur le téléphone (test-66)
1. Conduite → Calibrer → Démarrer : rouler sur une route qui vibre ; plus aucun message pendant le trajet ; regarder le résumé.
2. Virages connus : comparer l'angle affiché avec le ressenti ; ligne droite : 0°.
3. Musique : lancer une radio puis éteindre l'écran 5 min ; essayer ⏯ et ⏭ sur le casque / l'intercom et dans la notification.
4. Morceaux (Audius) : en lancer un, éteindre l'écran, vérifier l'enchaînement sur le suivant.
5. Détection de chute activée : passer un dos-d'âne puis s'arrêter → pas d'alerte ; « Simuler » marche toujours.
