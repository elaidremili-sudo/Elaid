# MotoRoute — instructions pour Claude

Application de club de motards (Capacitor + GitHub Actions, APK/AAB dans Releases, publication visée sur Google Play). Reprise : voir REPRISE.md.

## Règles de travail
- Répondre entièrement en français, y compris les récapitulatifs techniques.
- Construire avec son meilleur jugement, décider seul des choix réversibles et signaler ensuite les décisions prises ; ne demander que pour l'irréversible ou ce qui peut aller dans deux sens.
- Avant de débattre d'une conception, faire un essai jetable dans un worktree séparé et dire où la conception a gêné.
- Utiliser largement les skills installés et lancer plusieurs agents (chacun avec un skill) pour obtenir plusieurs avis.
- Ne jamais demander ni stocker la clé secret Supabase ; aucun secret dans le dépôt.

## Étendre Claude Code (email Claude du 13/11 : « Skills, MCP, subagents, or hooks? »)

### Skills (flux répétés)
- `/code-review` : avant chaque push / release test-NNN, relire le diff pour les bugs (SOS, SMS, consentement, groupe sanguin = zones sensibles).
- `/simplify` : après une série de modifications, nettoyer le code touché sans changer le comportement.
- `/loop` : pendant que la session reste ouverte, surveiller un build GitHub Actions ou un déploiement (ex. « vérifie le build test-NNN toutes les 5 min »).
- Quand la même suite d'étapes revient (publier une version, refaire la vidéo Google, mise à jour de REPRISE.md), en faire un skill personnel.

### MCP (outils hors du code)
- Utiliser les connecteurs déjà branchés plutôt que de demander des copies : GitHub (dépôt, Releases, Actions), Supabase « Motoroute », Sentry « remili-elaid/motoroute » (« regarde Sentry »), Expo/EAS si utile plus tard.
- Exemple de demande : « Lis les dernières erreurs Sentry, trouve la cause dans le code, corrige, ouvre une PR. »
- Ne jamais demander ni stocker la clé secret Supabase.

### Subagents (contexte isolé)
- `Explore` (intégré) : recherches larges dans le dépôt sans remplir la session principale.
- `.claude/agents/log-scanner.md` : premier échec d'un build GitHub Actions.
- Pour « faire le tour » d'un sujet : lancer plusieurs agents en parallèle (chacun avec son skill) et croiser leurs avis.

### Hooks (ce qui doit arriver à chaque fois)
- `PostToolUse` : formater chaque fichier modifié (Prettier) : non activé pour l’instant, Prettier n’est pas dans le projet (à ajouter d’abord).
- Idée suivante : un hook qui bloque l'écriture de toute clé secrète dans le dépôt.

### Plugins
- Un plugin regroupe skills + MCP + subagents + hooks. Parcourir avec `/plugin` (terminal) ou le bouton + (application bureau).
- Bug de l'outil : `/feedback` dans Claude Code.
