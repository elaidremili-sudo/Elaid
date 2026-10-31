# Google Play — déclaration du micro et du service au premier plan « microphone » (talkie-walkie)

Fonction concernée : **talkie-walkie de groupe à moto** (push-to-talk), module Android `MrTalkie` / `MrTalkieService`
(`scripts/patch-android.js`). La parole est **toujours démarrée par le motard** (bouton dans l'appli, bouton du casque
Bluetooth ou bouton de la notification) ; le service ne démarre jamais seul (ni au démarrage du téléphone, ni par notification push).

> ⚠️ Vérification faite depuis un environnement dont l'accès à developer.android.com et support.google.com était bloqué :
> ce qui suit reprend les règles Google telles que je les connais (Play Console, Android 14 à 16). **Relire les pages
> officielles listées en bas avant d'envoyer**, surtout les champs exacts du formulaire Play Console, qui changent souvent.

## 1. Où le déclarer dans Play Console

1. Play Console → l'appli MotoRoute → **Contenu de l'appli** (App content) → **Autorisations des services de premier plan**
   (Foreground service permissions). Obligatoire dès que l'appli cible Android 14+ (MotoRoute cible l'API 36) et qu'elle
   déclare un type de service au premier plan.
2. Cocher chaque type utilisé et remplir un bloc par type :
   - **Microphone** (nouveau : talkie-walkie) ;
   - **Lecture multimédia / Media playback** (déjà présent : musique en arrière-plan, `MrMusicService`) ;
   - le service de sirène SOS est de type `shortService` : à ma connaissance il n'a pas de case dédiée, mais **vérifier**
     dans le formulaire s'il le propose.
3. Pour chaque type, Google demande (à ma connaissance) : une **description de la fonction** qui utilise le service, l'**impact
   pour l'utilisateur** si le service ne peut pas tourner au premier plan, et un **lien vers une vidéo de démonstration**.
4. **Contenu de l'appli → Sécurité des données** (Data safety) : voir section 4.
5. Un changement de déclaration peut déclencher un nouvel examen : prévoir quelques jours avant la mise en production.

## 2. Textes à coller (anglais) — Foreground service type « Microphone »

**Which feature uses the microphone foreground service? (functionality description)**

> MotoRoute is a motorcycle club app. Its group walkie-talkie lets riders of the same ride group talk to each other
> with a push-to-talk button, like an intercom. When a rider taps "Walkie-talkie" in the app, accepts the system
> microphone permission and starts a channel, the app starts a foreground service of type "microphone" and shows a
> persistent notification ("Walkie-talkie — channel X") with "Talk" and "Stop" buttons. The service is required because
> the rider keeps the phone in a pocket or on the handlebar with the screen off, and must be able to speak and hear the
> group with a Bluetooth helmet headset button while the app is not on screen. The microphone is used only inside a
> channel session started by the user, and only a short push-to-talk message (30 seconds maximum) is transmitted each time
> the rider presses the talk button. The service never starts automatically (not at boot, not from a push message): it is
> always started by the user from the visible app. The user can stop it at any time from the notification or the app.

**What is the impact on the user if the app cannot run this foreground service?**

> Without a foreground service Android stops microphone capture as soon as the screen turns off or the app goes to the
> background. Riders would no longer be able to talk to their group while riding with the phone locked, which is the
> main purpose of the feature and a safety concern (they would have to look at and touch the phone while riding).

**How does the user start and stop it?**

> Start: from the visible app, tap "Walkie-talkie" then choose/join a channel (after the system microphone permission
> dialog). Stop: "Stop" button in the notification, or the stop button in the app. Each talk is started and ended by the
> user (app button, headset button or notification button).

**Demonstration video link:** (coller ici le lien YouTube « non répertoriée » / Drive public de la vidéo, voir section 3)

## 3. Vidéo de démonstration (à filmer par Elaid, 1 à 2 minutes, sans montage compliqué)

Google demande une vidéo montrant la fonction. Contenu attendu (à ma connaissance) pour un service « microphone » :

1. Écran du téléphone enregistré (enregistrement d'écran Android) + idéalement le casque Bluetooth visible à la fin.
2. Ouvrir MotoRoute, aller sur le talkie-walkie, appuyer sur le bouton qui le démarre.
3. Montrer la **fenêtre d'autorisation du micro** d'Android et l'accepter.
4. Montrer la **notification « 📻 Talkie-walkie — canal X »** avec les boutons Parler / Arrêter (déplier le volet de notifications).
5. Verrouiller l'écran, puis parler avec le **bouton du casque** (ou le bouton « Parler » de la notification) : montrer
   qu'un deuxième téléphone reçoit la voix (filmer les deux téléphones ou montrer l'écran du second).
6. Montrer comment on **arrête** (bouton « Arrêter » de la notification) et que la notification disparaît.
7. Hébergement : YouTube en « non répertoriée » ou lien Google Drive accessible sans connexion. Sous-titres ou texte
   à l'écran en anglais (« Step 1: user taps… »). Pas d'informations personnelles à l'écran (numéros, noms réels).

Faire la même chose pour **Media playback** si ce n'est pas déjà fait (lancer une radio, éteindre l'écran, la notification
de lecture reste, boutons du casque).

## 4. RECORD_AUDIO et Sécurité des données (Data safety)

- `RECORD_AUDIO` n'est pas dans la liste des autorisations « restreintes » (comme SMS, appels ou localisation en arrière-plan) :
  **pas de formulaire de déclaration d'autorisation spécifique** à ma connaissance. En revanche :
  - la politique **Données utilisateur** exige une **divulgation visible dans l'appli** avant la demande système quand
    l'appli collecte des données sensibles (la voix en fait partie) : prévoir dans la page du talkie une phrase claire
    avant le bouton (« MotoRoute utilise le micro uniquement quand tu démarres le talkie-walkie et que tu parles. Ta voix est
    envoyée aux membres du canal. »). Le texte affiché doit être le même que celui du formulaire.
  - la **politique de confidentialité** (`docs/confidentialite.html`, hors périmètre de cette tâche) doit mentionner le micro :
    à quoi il sert, que la voix est envoyée aux membres du canal, si elle est conservée ou non et combien de temps.
- **Data safety** : déclarer la collecte de **« Enregistrements vocaux ou sonores » (Voice or sound recordings)** si la voix transite
  par un serveur (même sans stockage, tout dépend de l'architecture de `talkie.js` : **à confirmer avec l'autre agent**).
  Finalités : fonctionnalité de l'appli ; partage : avec les autres membres du canal (action de l'utilisateur) ; non vendu ;
  chiffrement en transit : à confirmer ; suppression : à préciser (conservation = aucune si c'est du direct).
- `BLUETOOTH_CONNECT` (Android 12+, demandée une seule fois pour router le micro/son vers le casque) n'est pas une
  autorisation restreinte non plus. Elle s'affiche comme « Appareils à proximité ». Facultative : le talkie marche sans.
- `FOREGROUND_SERVICE_MICROPHONE` est une autorisation normale accordée à l'installation ; elle ne s'affiche pas au motard.

## 5. Comportement de l'appli à rappeler au relecteur (réponses aux questions possibles)

| Question possible | Réponse |
|---|---|
| Le micro écoute-t-il en continu ? | Non : seulement dans une session talkie démarrée par l'utilisateur ; la parole est émise par appui (30 s max), le voyant micro d'Android reste visible. |
| Le service démarre-t-il seul ? | Non : jamais au démarrage ni par message push ; seulement depuis l'appli visible après un geste. |
| Peut-on l'arrêter ? | Oui : bouton « Arrêter » de la notification, bouton de l'appli ; il s'arrête aussi si l'appli est fermée depuis les applis récentes. |
| Pourquoi un service au premier plan ? | Le motard roule écran éteint : sans service, Android coupe le micro en arrière-plan. |
| Enregistrement caché ? | Non : notification permanente visible tant que le micro est ouvert. |

## 6. Règles Android à garder en tête (résumé de ce que fait le code)

- Android 14+ (cible 34 et plus) : type de service obligatoire dans le manifeste, `FOREGROUND_SERVICE_MICROPHONE`, et
  `RECORD_AUDIO` accordée **avant** le démarrage (sinon `SecurityException`). Fait.
- Un service « microphone » ne peut être démarré que si l'appli est visible ou dans une exception prévue par Android :
  `start()` est appelé depuis la page ouverte ; sinon le plugin renvoie un code d'erreur
  (`micro-refuse`, `demarrage-interdit-arriere-plan`…) au lieu de planter.
- Android 15 : pas de limite de durée pour le type microphone (les limites visent dataSync et mediaProcessing) ; le service gère
  quand même `onTimeout`. Pas de démarrage depuis `BOOT_COMPLETED` (non utilisé).
- Android 16 (cible 36) : aucune règle nouvelle connue sur ce type ; **à reconfirmer** dans les notes de version.

## 7. Sources officielles à relire (non ouvertes depuis cet environnement)

- Google Play — exigences services au premier plan : https://support.google.com/googleplay/android-developer/answer/13392821
- Google Play — Sécurité des données : https://support.google.com/googleplay/android-developer/answer/10787469
- Google Play — politique Données utilisateur (divulgation visible) : https://support.google.com/googleplay/android-developer/answer/10144311
- Android — types de services au premier plan, microphone : https://developer.android.com/develop/background-work/services/fgs/service-types
- Android — restrictions de démarrage depuis l'arrière-plan : https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- Android 14 — type de service obligatoire : https://developer.android.com/about/versions/14/changes/fgs-types-required
- Android 15 — changements de comportement : https://developer.android.com/about/versions/15/behavior-changes-15
- Android 16 — changements de comportement : https://developer.android.com/about/versions/16/behavior-changes-16
- Android — focus audio : https://developer.android.com/media/optimize/audio-focus
