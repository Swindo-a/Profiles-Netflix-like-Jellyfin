# QuickPin sur TV Samsung (Tizen)

L'application Jellyfin officielle pour Samsung **embarque sa propre copie du client web**
dans le paquet `.wgt`. Le plugin serveur ne peut donc pas y injecter QuickPin tout seul :
il faut construire et sideloader une version personnalisée de l'app, avec un petit loader
intégré qui chargera le script QuickPin **depuis votre serveur**.

Bonne nouvelle : une fois ce `.wgt` installé, toutes les mises à jour de QuickPin
(profils, PIN, titre…) se font côté serveur, sans retoucher la TV.

> Alternative sans build : ouvrez simplement votre serveur Jellyfin dans le
> **navigateur de la TV**. Le script étant injecté côté serveur, l'écran QuickPin
> s'affiche immédiatement.

## Prérequis

1. **Node.js 20+**
2. **Tizen Studio avec CLI** — installez le CLI et ajoutez `tizen` et `sdb` au PATH.
3. **Certificat** — créez un profil de certificat dans *Tizen Certificate Manager*.
   Pour la plupart des TV récentes, choisissez un certificat **Samsung** (et non Tizen)
   et déclarez le DUID de votre TV.
4. **Mode développeur sur la TV** :
   - Ouvrez le menu *Apps*, tapez `12345` sur la télécommande.
   - Activez *Developer mode*, saisissez l'**IP de votre PC**, redémarrez la TV.

## Build

```sh
./build-tizen.sh
```

Le script :

1. clone `jellyfin-web` (branche `release-10.11.z` par défaut — alignez-la sur la
   version de votre serveur avec `JF_WEB_BRANCH=release-10.10.z ./build-tizen.sh`) ;
2. build le client web (`USE_SYSTEM_FONTS=1 npm run build:production`) ;
3. injecte le loader QuickPin dans `dist/index.html` ;
4. prépare `jellyfin-tizen` (`JELLYFIN_WEB_DIR=../jellyfin-web/dist npm ci`) ;
5. package le `.wgt` (`tizen build-web` puis `tizen package`).

## Installation sur la TV

```sh
sdb connect IP_DE_LA_TV
sdb devices                                   # noter l'identifiant (ex. UE65NU7400)
tizen install -n Jellyfin.wgt -t IDENTIFIANT
```

Si l'installation échoue avec une erreur de permission, lancez d'abord :

```sh
tizen install-permit -t IDENTIFIANT
```

## Fonctionnement du loader

L'app Tizen tourne en local : le serveur n'est connu qu'après l'avoir ajouté dans
l'app. Le loader lit l'adresse du serveur dans `localStorage` (`jellyfin_credentials`)
puis charge `https://votre-serveur/QuickPin/ClientScript` via une balise `<script>`
(non soumise à CORS). Au tout premier lancement, ajoutez votre serveur et connectez-vous
une première fois de façon classique ; dès la déconnexion suivante, l'écran QuickPin
prend le relais.
