# MotoRoute – Point du 23 octobre 2026, 10 h 50 (LIRE EN PREMIER, puis POINT-22-10.md et REPRISE.md)

Dernière version de l'app : **test-52** (rien n'a changé dans l'app ce jour, seulement le serveur Supabase).

## 🔐 Relecture de sécurité avant Google Play (faite par Claude)
Contrôlé : secrets dans tout l'historique du dépôt (aucun), règles d'accès des 20 tables (toutes verrouillées),
31 fonctions serveur, fonctions sos-push et partner-notify, affichage des textes dans l'app (protégé).

### Corrigé et mis en ligne le 23/10
1. **Sirène SOS** (fonction `sos-push`, version 8) : le texte affiché et lu à voix haute est maintenant rédigé
   par le serveur (nom de la fiche d'urgence, moto, coordonnées GPS), dans la langue de celui qui reçoit.
   Avant, le téléphone pouvait envoyer n'importe quel texte → un membre d'un groupe public pouvait faire
   sonner et parler tous les téléphones du groupe. Limite : **5 alertes par heure** vers les autres
   (avant 6 par 10 minutes) ; essai sur son propre téléphone : 6 par 10 minutes. Le SOS automatique marche pareil.
2. **Codes partenaires** : 10 caractères tirés au hasard de façon sûre (avant 6, devinables en boucle).
   ⚠️ Les anciens codes de Simou Cycle, Planète Moto et Iyade Moto **ne marchent plus** : les nouveaux sont
   visibles dans l'espace administrateur des vitrines (ne pas les écrire dans ce dépôt public).
   Codes anges gardiens : toujours 6 caractères (l'app attend ce format), tirage désormais sûr.
3. **Fonctions internes** : 12 fonctions ne sont plus appelables sans être connecté
   (le contrôle Supabase passe de 14 alertes à 2 ; les 2 restantes, mr_is_admin et mr_partner_owner,
   sont voulues : la lecture des vitrines s'en sert).

Script : `supabase/securite-23-10.sql` (déjà appliqué par Claude, rejouable sans risque).
Fonction : `supabase/functions/sos-push/index.ts` (déployée, identique au dépôt).

Vérifié en ligne : vitrines lisibles sans compte (4) ; espace administrateur OK pour Elaid (3 partenaires) ;
compte simple (Ali) : groupes, membres, profils visibles comme avant, pas administrateur ;
mr_partner_claim refusé sans compte ; 3 codes partenaires au nouveau format.

### À faire par Elaid
- **Tester la sirène avec les 2 téléphones** (« 🔔 Tester la sirène chez eux ») : vérifier que le message lu
  à voix haute est correct (nom, moto, coordonnées). Pas testé de bout en bout par Claude (il faut les téléphones).
- Donner les **nouveaux codes** aux partenaires quand ils seront prêts.
- Facultatif : la protection « mots de passe déjà piratés » de Supabase (Authentication → Policies)
  n'existe que sur l'offre payante → rien à faire pour l'instant.

### Non corrigé (risque faible, pour plus tard)
- Les essais de codes (groupe privé, ange gardien, partenaire) ne sont pas limités en nombre ; les codes
  longs suffisent pour les partenaires. Les codes de groupe et d'ange gardien (6 caractères) pourraient
  passer à 8 dans une prochaine version de l'app.
- La clé Firebase de l'app (google-services.json) est publique par nature : la restreindre à l'appli
  Android com.motoroute.app dans Google Cloud Console (Identifiants) quand il y aura un moment.
