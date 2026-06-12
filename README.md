<<<<<<< HEAD
# 🔐 Jellyfin QuickPin

Plugin Jellyfin qui remplace l'écran de connexion par une **sélection de profils façon
Netflix** : on choisit son avatar, on tape un **code PIN** sur la télécommande, et c'est
parti. Pensé pour la TV (Samsung/Tizen, LG/webOS, navigateurs) : gros avatars, pavé
numérique navigable au D-pad, saisie directe avec les touches chiffrées de la télécommande.

- Jusqu'à **6 profils** configurables (3 par défaut, c'est vous qui choisissez).
- PIN de 4 à 6 chiffres, **hachés côté serveur** (PBKDF2-SHA256, jamais stockés en clair).
- **Anti-bruteforce** : verrouillage temporaire après 5 échecs.
- Les **mots de passe classiques restent intacts** : QuickPin s'ajoute, il ne remplace rien.
  Un lien discret « Connexion classique » reste disponible (désactivable).
- Compatible **Jellyfin 10.11.x** (.NET 9).

## ⚠️ Important pour les TV Samsung

L'application Jellyfin du store Samsung **embarque sa propre copie du client web** :
le plugin seul ne peut pas modifier son interface. Deux options :

- **Option A — immédiate** : utilisez le **navigateur de la TV** (ou n'importe quel
  client web servi par votre serveur). Le script est injecté côté serveur, l'écran
  QuickPin apparaît directement.
- **Option B — app native** : construisez et sideloadez une version personnalisée de
  l'app Tizen avec le loader QuickPin intégré. Tout est fourni dans le dossier
  [`tizen/`](tizen/) (script `build-tizen.sh` + guide pas à pas). Une fois installée,
  toute la configuration se gère côté serveur.

## Installation du plugin

1. Téléchargez `Jellyfin.Plugin.QuickPin.dll` (depuis les *Releases* GitHub, ou
   compilez avec `dotnet publish -c Release`).
2. Sur le serveur, créez le dossier `plugins/QuickPin_1.0.0.0/` dans le répertoire de
   données Jellyfin et placez-y la DLL.
3. Redémarrez Jellyfin.
4. Tableau de bord → **Plugins → QuickPin** : choisissez vos 3 profils (ou plus),
   définissez un PIN pour chacun, enregistrez.
5. Ouvrez la page de connexion : l'écran QuickPin s'affiche.

Le plugin injecte une balise `<script>` dans l'`index.html` du client web servi par le
serveur (technique utilisée par Intro Skipper, Jellyscrub, etc.). C'est automatique et
idempotent.

### Docker / permissions

Si les logs affichent un avertissement d'écriture sur `index.html`, le serveur n'a pas
les droits sur le dossier web. Solutions : monter le dossier `jellyfin-web` en écriture,
ou ajouter la balise à la main dans `index.html` juste avant `</body>` :

```html
<script plugin="QuickPin" defer="defer" src="QuickPin/ClientScript"></script>
```

### Désinstallation

Supprimez le dossier du plugin et redémarrez. Si la balise injectée subsiste dans
`index.html`, elle provoque un 404 silencieux et inoffensif ; retirez-la à la main
(ou réinstallez le client web) pour un nettoyage complet.

## Configuration

| Réglage | Description |
|---|---|
| Titre | Texte affiché au-dessus des profils (« Qui est-ce ? » par défaut) |
| Longueur du PIN | 4, 5 ou 6 chiffres — identique pour tous les profils |
| Lien « Connexion classique » | Garde un accès au formulaire standard (recommandé) |
| Injection automatique | Insère le script dans le client web servi par le serveur |
| Profils | Jusqu'à 6 utilisateurs, chacun avec son PIN |

Si vous changez la longueur du PIN, ressaisissez le PIN de chaque profil (les anciens
hash ne sont plus valides).

## Utilisation à la télécommande

- **Flèches** : naviguer entre les profils et sur le pavé.
- **Touches chiffrées** : sur l'écran des profils, `1`/`2`/`3` sélectionnent directement
  le 1ᵉʳ/2ᵉ/3ᵉ profil ; sur l'écran PIN, elles saisissent les chiffres.
- **OK** : valider. La connexion part automatiquement au dernier chiffre.
- **Retour** (Tizen `10009`, webOS `461`, Échap) : revenir aux profils, puis au
  formulaire classique.

## Sécurité — à lire

- Un PIN à 4 chiffres ne vaut pas un mot de passe : 10 000 combinaisons. Le verrouillage
  (5 échecs → 60 s, par utilisateur + IP) rend la force brute pénible, mais réservez
  QuickPin à un **usage LAN/familial**, ou derrière HTTPS si votre serveur est exposé.
- **Ne mettez pas le compte administrateur** dans les profils QuickPin. Gardez-lui un
  vrai mot de passe et la connexion classique.
- L'endpoint public `/QuickPin/Profiles` expose le nom et l'avatar des profils
  configurés — c'est le principe d'un écran de sélection, mais sachez-le si votre
  serveur est accessible depuis Internet.
- Les PIN sont hachés (PBKDF2-SHA256, 100 000 itérations, sel aléatoire) et comparés en
  temps constant.

## Architecture

```
Jellyfin.Plugin.QuickPin/
├── Plugin.cs                    # Plugin + injection du script dans index.html
├── PinHasher.cs                 # PBKDF2-SHA256
├── Api/QuickPinController.cs    # /QuickPin/Profiles, /Authenticate (AuthenticateDirect),
│                                # /ClientScript, /AdminInfo (GET/POST, RequiresElevation)
├── Configuration/
│   ├── PluginConfiguration.cs   # Profils (UserId + hash + sel), options
│   └── configPage.html          # Page d'admin (Dashboard → Plugins → QuickPin)
└── Web/quickpin.js              # Overlay profils + pavé PIN, navigation D-pad
```

L'authentification s'appuie sur `ISessionManager.AuthenticateDirect` (la même API que le
plugin SSO officiel) : après vérification du PIN, le serveur émet un jeton de session
Jellyfin standard. Le script client enregistre ensuite les identifiants exactement comme
le ferait jellyfin-web (`jellyfin_credentials` + `enableAutoLogin`).

## Compiler soi-même

```sh
dotnet publish Jellyfin.Plugin.QuickPin -c Release -o publish
```

La DLL se trouve dans `publish/Jellyfin.Plugin.QuickPin.dll`. Le workflow GitHub Actions
fourni compile à chaque push et attache la DLL zippée aux releases taguées `v*`.

> Compatibilité : ciblé Jellyfin **10.11** (entité `User` dans
> `Jellyfin.Database.Implementations.Entities`). Pour 10.10, remplacez ce namespace par
> `Jellyfin.Data.Entities`, `Jellyfin.Database.Implementations.Enums` par
> `Jellyfin.Data.Enums`, et ciblez `net8.0` avec les paquets `10.10.*`.

```

## Licence

MIT — voir [LICENSE](LICENSE).
