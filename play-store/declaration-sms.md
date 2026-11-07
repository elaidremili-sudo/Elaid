# Google Play : déclaration de l'autorisation SMS (SEND_SMS)

Préparé le 07/11/2026 pour test-100, corrigé après une relecture critique (agent « examinateur sévère ») confrontée au code. Où : **Play Console → MotoRoute → Contenu de l'appli (App content) →
Autorisations sensibles / Permissions declaration form → SMS et journal d'appels**.
La déclaration est demandée au premier envoi d'une version qui contient `SEND_SMS`, y compris en test fermé.

> À relire avant d'envoyer : les intitulés exacts du formulaire changent souvent. Les textes à coller sont en anglais
> (Google examine en anglais) ; la traduction française de chaque texte est juste en dessous.

---

## 1. Ce que fait l'appli (faits vérifiés dans le code de test-100)

| Point | Réalité dans MotoRoute |
|---|---|
| Autorisations SMS / journal d'appels demandées | **`SEND_SMS` seulement.** La fabrication échoue si l'une de ces autorisations apparaît : READ_SMS, RECEIVE_SMS, WRITE_SMS, RECEIVE_MMS, RECEIVE_WAP_PUSH, READ_CALL_LOG, WRITE_CALL_LOG, PROCESS_OUTGOING_CALLS, CALL_PHONE, READ_PHONE_STATE, READ_CONTACTS (`.github/workflows/android.yml`). |
| Quand l'autorisation est demandée | Seulement quand le motard **active lui-même** « Détection de chute » (désactivée par défaut), après une fenêtre qui explique pourquoi. |
| Quand un SMS part tout seul | Détection de chute activée, **appli ouverte** (détection faite par l'appli elle-même, pas en tâche de fond) **et** moto qui roulait (GPS ≥ 15 km/h dans les 90 s avant) **et** choc > 4 g avec téléphone basculé de plus de 35° (ou choc > 6 g) **et** téléphone immobile ensuite ; sans vitesse GPS récente (tunnel) : seulement choc > 8 g et bascule > 35°. Puis **2 minutes** de fenêtre d'alerte avec bip toutes les 2 s et gros bouton « Je vais bien — annuler ». |
| À qui | **Uniquement** aux numéros que le motard a saisis lui-même dans sa fiche d'urgence (**2 au plus**). Le module Android refuse tout autre numéro ; la liste ne peut être changée que quand l'appli est à l'écran. |
| Combien | **1 SMS** par numéro et par alerte (2 nouveaux essais seulement si le réseau le refuse) ; plafond codé dans le module Android : **6 SMS par 10 minutes**, en comptant chaque morceau d'un long SMS ; le SMS de test ne peut en utiliser que 2. |
| Contenu | Texte fixe : nom, moto, groupe sanguin (s'ils sont remplis), coordonnées GPS à 5 décimales. Français/anglais : 1 SMS de 160 caractères max, ex. `MotoRoute SOS: CHUTE Elaid (Z H2) sang O+. GPS 36.12345,4.12345. Pas de reponse 2 min`. En arabe, le message peut partir en 2 ou 3 morceaux (caractères arabes). |
| Envois manuels | **Un seul** utilise SEND_SMS : « Tester le SMS » (Mes urgences), lancé et confirmé par le motard, marqué TEST, vers le premier numéro d'urgence enregistré (pour vérifier que l'alerte partira). Tous les autres SMS manuels (bouton SOS, écran de connexion, version sans SMS) ouvrent l'appli SMS du téléphone avec le message prérempli (lien `sms:`), le motard appuie lui-même sur Envoyer. |
| Ce qui n'est jamais fait | Lire, recevoir, stocker ou envoyer au serveur des SMS ; SMS publicitaire ; SMS vers un contact du carnet ; SMS payant. |

---

## 2. Formulaire : réponses

**Core functionality / Fonction principale :** cocher **« Physical safety / emergency alert apps (send SMS) »**
(« Applications de sécurité physique / d'alerte d'urgence »). Ne rien cocher d'autre.

**Is SEND_SMS required for the core functionality? / Indispensable ?** Oui.

### Texte 1 — Description of the feature (à coller)

> MotoRoute is a safety app for motorcycle riders in Algeria. Its core safety feature is automatic crash detection with an
> emergency SMS. The rider turns crash detection on (it is off by default) and saves one or two emergency phone numbers on
> their emergency card. While crash detection is on and the app is open (typically on the handlebar mount), a crash is
> detected when the motorcycle was moving at 15 km/h or more in the previous 90 seconds, then an impact above 4 g with the
> phone tilting over 35° (or above 6 g), then no movement. Without recent GPS speed (e.g. in a tunnel), only an impact above
> 8 g with tilt counts. The app then shows an alert dialog with a repeating beep and a large "I'm OK – cancel" button for
> 2 minutes. If the rider does not respond, the app sends one short alert message to those saved numbers only: the rider's
> name, motorcycle, blood type and GPS coordinates, for example
> "MotoRoute SOS: CRASH Elaid (Z H2) blood O+. GPS 36.12345,4.12345. No answer 2 min".
> SEND_SMS is the only SMS-related permission in the app. Besides this automatic alert, SEND_SMS is used for one action
> only: a test SMS marked TEST, started and confirmed by the rider, sent to the first saved emergency number. The app never reads,
> receives or stores SMS, never sends SMS to any number the rider did not enter, and is limited in code to 6 SMS per
> 10 minutes.

*Traduction :* MotoRoute est une appli de sécurité pour motards en Algérie. Sa fonction de sécurité principale est la
détection automatique de chute avec SMS d'urgence. Le motard active la détection (désactivée par défaut) et enregistre un
ou deux numéros d'urgence. Tant que la détection est activée et l'appli ouverte (en général sur le support du guidon), une
chute est retenue si la moto roulait à 15 km/h ou plus dans les 90 s précédentes, puis choc de plus de 4 g avec téléphone
basculé de plus de 35° (ou plus de 6 g), puis plus aucun mouvement ; sans vitesse GPS récente (tunnel), seulement un choc
de plus de 8 g avec bascule. L'appli affiche alors une fenêtre d'alerte avec bip répété et gros bouton « Je vais bien —
annuler » pendant 2 minutes. Sans réponse, elle envoie un message d'alerte court à ces numéros seulement : nom, moto, groupe
sanguin, coordonnées GPS. SEND_SMS est la seule autorisation SMS de l'appli. En dehors de cette alerte, elle ne sert qu'à
un SMS de test marqué TEST, lancé et confirmé par le motard, vers le premier numéro d'urgence enregistré. L'appli ne lit, ne reçoit ni ne garde
aucun SMS, n'écrit à aucun numéro que le motard n'a pas saisi, et est limitée dans le code à 6 SMS par 10 minutes.

### Texte 2 — Why alternatives are not enough (à coller)

> We considered every alternative; none can reach help in the situation this feature is built for, an unconscious or
> injured rider alone on a road:
> 1. Pre-filled SMS (ACTION_SENDTO intent): the rider must tap "Send". An unconscious rider cannot. We use this intent for
>    every manual SOS (SOS button, sign-in screen): it opens the user's SMS app pre-filled. SEND_SMS is used only for the
>    automatic crash alert, plus a test SMS the rider starts to check that the alert will work.
> 2. Internet alerts (push notifications to the rider's club group, which MotoRoute also sends): they need mobile data.
>    Mountain and desert roads in Algeria very often have GSM voice/SMS coverage but no usable data. In that case the push
>    alert never leaves the phone, while an SMS still goes through.
> 3. Server-sent SMS (SMS gateway): the phone would first have to reach the server over the internet, so it fails in the
>    same places as option 2.
> 4. Automatic phone call: a call cannot transmit exact GPS coordinates to the person called (Android gives a regular app
>    no way to play a voice message into a phone call), and the person may not answer. We removed automatic calls for
>    this reason; the app has no CALL_PHONE permission.
> Only an SMS sent by the phone itself delivers the exact position, in writing, without internet and without any action
> from the injured rider.

*Traduction :* Nous avons étudié chaque solution ; aucune ne peut prévenir les secours dans la situation visée, un motard
inconscient ou blessé, seul sur la route :
1. SMS prérempli : il faut toucher « Envoyer », impossible pour un motard inconscient. Nous l'utilisons pour tous les cas
   SOS manuels (bouton SOS, écran de connexion) : l'appli SMS s'ouvre avec le message prérempli. SEND_SMS ne sert qu'à
   l'alerte automatique de chute, plus le SMS de test que le motard lance pour vérifier que l'alerte partira.
2. Alertes par internet (notifications au groupe du club, que MotoRoute envoie aussi) : il faut des données mobiles. Les
   routes de montagne et du Sud algérien ont très souvent du réseau GSM (voix/SMS) mais pas de données utilisables :
   l'alerte internet ne part pas, le SMS passe.
3. SMS envoyé par un serveur : le téléphone doit d'abord joindre le serveur par internet, donc même problème.
4. Appel automatique : un appel ne transmet pas les coordonnées GPS exactes (Android ne donne à une appli ordinaire aucun
   moyen de faire entendre un message vocal dans l'appel), et la personne peut ne pas répondre. Nous avons retiré l'appel
   automatique pour cette raison ; l'appli n'a pas l'autorisation CALL_PHONE.
Seul un SMS envoyé par le téléphone lui-même transmet la position exacte, par écrit, sans internet et sans action du blessé.

### Texte 3 — User disclosure and control (à coller)

> Crash detection and the emergency SMS are off by default. Before Android's permission screen, a dialog explains that the
> SMS permission is used only to send one alert SMS to the emergency numbers the rider saved, if they crash and do not
> answer for 2 minutes (and for the test SMS they start themselves), and that the app never reads SMS. The rider can
> send a test SMS (marked TEST) at any time, sees on screen exactly which numbers will be alerted, can cancel during the
> 2-minute countdown, and can turn the feature off in one tap. The privacy policy describes the emergency SMS:
> https://elaidremili-sudo.github.io/Elaid/confidentialite.html

*Traduction :* Détection de chute et SMS d'urgence désactivés par défaut. Avant l'écran d'autorisation d'Android, une
fenêtre explique que l'autorisation sert seulement à envoyer UN SMS d'alerte aux numéros enregistrés en cas de chute sans
réponse pendant 2 minutes (et au SMS de test lancé par le motard), et que l'appli ne lit jamais les SMS. Il peut envoyer un
SMS de test (marqué TEST), voit à l'écran les numéros prévenus, peut annuler pendant les 2 minutes et désactiver la
fonction d'un toucher. La politique de confidentialité décrit le SMS d'urgence.

---

## 3. Vidéo de démonstration (à filmer par Elaid, 1 à 2 min, YouTube « non répertoriée »)

Google demande souvent une vidéo pour cette exception. Filmer l'écran du téléphone (enregistreur d'écran Android) et, si
possible, le second téléphone qui reçoit le SMS. Activer d'abord le mode essai (7 touchers sur le titre de la fenêtre 🔑)
pour faire apparaître « Simuler une chute ». Filmer **appli ouverte** : la détection ne tourne pas écran éteint.

1. Ouvrir Route → Détection de chute → l'activer : montrer la fenêtre d'explication puis la demande d'autorisation SMS.
2. Mes urgences : montrer le contact d'urgence enregistré (un seul numéro, le second téléphone).
3. Toucher « Simuler une chute » : montrer la fenêtre d'alerte, le bip, le compte à rebours de 2 minutes et le bouton
   « Je vais bien — annuler » (on peut couper la vidéo pendant l'attente).
4. Fin du compte à rebours : montrer l'écran « SMS parti vers … ».
5. Second téléphone : montrer le SMS reçu avec les coordonnées GPS, puis toucher le lien ou coller les coordonnées dans
   Google Maps.
6. Dernière image : Route → Détection de chute désactivée d'un toucher.

Ajouter des sous-titres anglais simples (ex. « Crash detected – 2-minute countdown – the rider can cancel »).

---

## 4. Fiche Play : mettre la sécurité en avant (sinon risque « ne correspond pas à la fonction principale »)

**Description courte (80 caractères max) :**
`Sécurité moto : détection de chute, SOS par SMS, sorties et talkie de club` (FR)
`Motorcycle safety: crash detection, SOS by SMS, club rides and walkie-talkie` (EN)

**Début de la description longue (les 3 premières lignes sont lues en premier) :**

> 🆘 **MotoRoute veille sur toi à moto.** Si tu chutes et ne réponds plus pendant 2 minutes, ton téléphone envoie tout
> seul un SMS avec ta position GPS exacte à tes proches, même sans internet, et alerte ton groupe de motards.
>
> 🛟 Détection de chute · SOS en un toucher · fiche d'urgence (groupe sanguin, allergies) · anges gardiens · premiers secours
>
> 🏍 Et pour rouler ensemble : sorties de club, groupes, talkie-walkie, carnet de route, bonnes adresses, cartes hors ligne.

**Captures d'écran :** la **1re** doit montrer le SOS / la détection de chute (Route avec SOS en haut ou l'alarme de
chute), la **2e** Mes urgences. Les sorties et annonces viennent après.

---

## 5. Accès pour l'équipe d'examen (Contenu de l'appli → Accès à l'appli)

Créer un compte réservé à Google (e-mail confirmé), membre d'un groupe avec une sortie, fiche d'urgence remplie avec un
numéro d'essai. **Puis demander à Claude d'activer le mode essai sur ce compte** (champ `mr_dev` des données du compte,
mis côté serveur) : le bouton « Simuler une chute » sera visible sans les 7 touchers. Texte à coller :

> Login: [e-mail du compte de test] / Password: [mot de passe]. The app requires an account. To see the crash SMS feature:
> open the "Route" tab → "Crash detection" → turn it on and allow SMS. "My emergencies" shows the saved test number.
> Test mode is already enabled on this account: the "Simulate a crash" button is visible in the Route tab (it is hidden
> for normal users). It starts the real alert flow with a TEST SMS to the saved test number.

---

## 6. Si Google refuse

1. Lire le motif exact (e-mail et Play Console → Boîte de réception des règles).
2. Plan B immédiat : relancer la fabrication à la main avec la case **`sans_sms`** (Actions → « Fabriquer l'appli Android »
   → Run workflow). Cette version n'a ni SEND_SMS ni CALL_PHONE : SMS prérempli à toucher + alertes de groupe et anges
   gardiens par internet. L'envoyer pour ne pas bloquer les 14 jours de test.
3. Faire appel avec les textes ci-dessus et la vidéo, puis remettre le SMS automatique dans une version suivante si
   l'exception est accordée.

## Sources consultées le 07/11/2026

- Aide Play Console, exceptions SMS / journal d'appels (catégorie « Physical safety/emergency alerts to send SMS ») :
  https://support.google.com/googleplay/android-developer/answer/17225965 et
  https://support.google.com/googleplay/android-developer/answer/10208820
- Critères d'examen annoncés par Google (2019) : https://android-developers.googleblog.com/2019/01/reminder-smscall-log-policy-changes.html

## 7. Points sensibles relevés par la relecture (à garder en tête)

- **La détection ne marche qu'appli ouverte.** Ne jamais écrire le contraire dans la fiche ni filmer écran éteint.
- **Fonction principale** : un examinateur voit aussi les sorties, annonces, talkie et pubs. D'où la fiche, la 1re capture
  et la vidéo centrées sur la sécurité.
- **Groupe sanguin** : il part dans le SMS et dans l'alerte aux groupes. C'est écrit dans la politique (section Fiche
  d'urgence) ; dans « Sécurité des données », cocher **Infos de santé → partagées** pour la fonction SOS.
- Si l'exception est refusée pour « alternative disponible », proposer en appel de ne garder SEND_SMS que pour l'alerte
  automatique (retirer « Tester le SMS »).
