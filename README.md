# gg-deals-mcp

[![Soutenir sur Ko-fi](https://img.shields.io/badge/Ko--fi-Soutenir%20le%20projet-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/pierrobn)
[![CI](https://github.com/pierro-bn/gg-deals-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/pierro-bn/gg-deals-mcp/actions/workflows/ci.yml)

Serveur MCP en lecture seule pour l’[API Prices officielle de GG.deals](https://gg.deals/api/prices/). Il permet à un assistant de comparer les prix de jeux, packs et bundles Steam. Projet communautaire indépendant, sans affiliation avec GG.deals ou Valve.

## Installation

Prérequis : **Node.js 22 ou plus récent**, npm et une clé API créée dans les [paramètres de votre compte GG.deals](https://gg.deals/settings/).

```sh
git clone https://github.com/pierro-bn/gg-deals-mcp.git
cd gg-deals-mcp
npm ci
npm test
```

Le serveur est écrit en TypeScript strict. `npm ci` compile automatiquement les sources dans `dist/` via le script `prepare`. Après une modification des sources, lancez `npm run build`. Le serveur démarre avec `node /chemin/absolu/gg-deals-mcp/dist/index.js` et communique sur **stdio**. L’absence de texte au démarrage est normale : il attend les messages du client MCP.

Dans un client acceptant le format `mcpServers`, adaptez cet exemple à votre installation :

```json
{
  "mcpServers": {
    "gg-deals": {
      "command": "node",
      "args": ["C:/mcp/gg-deals-mcp/dist/index.js"],
      "env": {
        "GG_DEALS_API_KEY": "REPLACE_LOCALLY",
        "GG_DEALS_REGION": "fr"
      }
    }
  }
}
```

Sous macOS/Linux, remplacez le chemin Windows par le chemin absolu du fichier. Si le client ne trouve pas Node, indiquez aussi le chemin absolu de l’exécutable. Utilisez toujours le chemin de votre propre clone.

Renseignez la clé uniquement dans la configuration privée du client ou dans son gestionnaire de secrets, puis redémarrez le serveur. **Ne transmettez pas la clé à l’assistant et ne la commitez pas.** `GG_DEALS_REGION` est facultatif et vaut `fr` par défaut ; un appel peut choisir une autre région.

Le fichier `.env.example` sert de modèle. Les fichiers `.env` ne sont pas chargés automatiquement. Pour un démarrage manuel avec un fichier local, Node permet `node --env-file=.env dist/index.js` depuis le dépôt.

Le dépôt distribue le code source sur GitHub. Il ne fournit pas d’URL MCP hébergée ni de publication npm. Le client doit pouvoir lancer un processus local sur stdio.

## Outils

| Outil | Utilisation |
| --- | --- |
| `gg_deals_status` | Configuration locale, régions disponibles et dernier quota reçu, sans appel réseau |
| `gg_deals_prices_by_steam_app_id` | Prix des jeux, à partir des IDs `/app/` de Steam |
| `gg_deals_prices_by_steam_sub_id` | Prix des packs, à partir des IDs `/sub/` |
| `gg_deals_prices_by_steam_bundle_id` | Prix des bundles, à partir des IDs `/bundle/` |

Les outils de prix prennent `ids` (tableau de 1 à 100 entiers positifs) et éventuellement `region`. Exemple d’arguments pour un jeu :

```json
{ "ids": [420], "region": "fr" }
```

Exemples de demandes à un assistant connecté :

- « Compare les prix actuels et historiques du jeu Steam 420 en France. »
- « Donne les prix des boutiques officielles pour les IDs Steam suivants : 570, 730. »
- « Vérifie si le MCP GG.deals est configuré. »

Le statut `configured: true` indique uniquement qu’une clé locale est présente. Sa validité est vérifiée par GG.deals lors d’un appel de prix.

## Lire les résultats

`data` contient les jeux indexés par ID, leur titre, leur lien GG.deals et un objet `prices`. Ce dernier distingue les prix actuels (`currentRetail`, `currentKeyshops`) des minimums historiques (`historicalRetail`, `historicalKeyshops`). La devise figure dans `currency`. Les montants restent des chaînes décimales pour préserver leur précision. Une valeur `null` signifie inconnue ou indisponible ; elle ne signifie jamais gratuit.

Les résultats ajoutent la région, le type d’ID, les dates de récupération par ID, le nombre d’éléments issus du cache et les derniers en-têtes de quota observés. Les prix peuvent changer avant l’achat.

Cette API ne recherche pas les jeux par nom et ne liste pas chaque offre marchande. Obtenez d’abord les IDs Steam avec un autre outil si nécessaire. L’API Bundles distincte de GG.deals n’est pas incluse : l’outil bundle de ce projet consulte uniquement les prix des bundles Steam.

## Cache, quotas et erreurs

Le cache en mémoire dure cinq minutes, séparément pour chaque ID, région et type. Les doublons sont éliminés avant l’appel réseau. Seuls les IDs absents du cache sont demandés.

GG.deals limite la clé à 100 éléments par minute et 1 000 par heure. Le serveur applique aussi ces limites dans son propre processus, y compris aux appels simultanés. Plusieurs processus ou applications utilisant la même clé partagent le quota distant, mais pas le compteur local. Un redémarrage efface cache et compteurs locaux.

Les erreurs de quota sont rendues à l’assistant avec un délai `retryAfterSeconds`. Aucun nouvel essai automatique ne consomme de quota supplémentaire. Le délai réseau est de 15 secondes. Les réponses HTTP, erreurs réseau et erreurs de format sont remplacées par des messages contrôlés ; les URLs contenant la clé, corps d’erreur distants et causes brutes ne sont pas renvoyés. Les redirections HTTP sont refusées.

## Migration depuis la version JavaScript

Après la mise à jour du dépôt, exécutez `npm ci`, puis remplacez `src/index.js` par `dist/index.js` dans la configuration de votre client MCP et redémarrez le serveur. Les outils, leurs arguments et les variables d’environnement restent identiques.

## Réponses compactes et économie de tokens

Les trois outils de prix acceptent `detail: "compact"` (par défaut) ou `detail: "detailed"`. Le mode compact omet uniquement les dernières métadonnées de quota `rateLimit`, consultables via le statut ou le mode détaillé. Les quatre prix actuels/historiques, leur devise, les valeurs inconnues, la région et les dates de récupération par ID restent présents. Les réponses étant déjà courtes, le gain attendu est limité.

Exemple : `{"ids":[420],"region":"fr","detail":"detailed"}`. Les résultats structurés et leur représentation texte sont conservés pour la compatibilité des clients MCP.

Les gains dépendent de la taille des résultats et du client MCP ; ce mode ne garantit pas un pourcentage de réduction des tokens.

## Développement et vérification

```sh
npm run typecheck
npm test
npm audit --omit=dev --audit-level=high
```

Les sources (`src/*.ts`) et les tests (`test/*.ts`) sont vérifiés en mode strict. `npm test` compile le serveur dans `dist/`, compile la suite dans `.test-build/`, puis lance les tests avec Node. Le test stdio lance le point d’entrée `dist/index.js`. Ces deux répertoires générés sont ignorés par Git.

Les tests utilisent des réponses simulées pour vérifier les trois routes, les paramètres, les prix absents, le cache, les quotas, les erreurs et la confidentialité de la clé. Ils vérifient aussi le dialogue MCP, la découverte des outils et le démarrage stdio depuis un autre répertoire. Ils ne nécessitent pas de clé et ne constituent pas un test réel du compte GG.deals.

GitHub Actions exécute les vérifications sous Windows et Linux, avec Node 22 et 24. Les dépendances sont verrouillées dans `package-lock.json`. Ce serveur utilise le SDK MCP TypeScript 1.x ; les autres serveurs peuvent utiliser une autre version du SDK.

## Soutenir le projet

Si ce serveur MCP vous est utile, vous pouvez soutenir son développement et sa maintenance avec un don facultatif sur [Ko-fi](https://ko-fi.com/pierrobn). Merci pour votre soutien !

## Licence

MIT, voir [LICENSE](LICENSE). L’utilisation de l’API reste soumise aux [conditions de GG.deals](https://gg.deals/terms/).
