#!/usr/bin/env bash
# Build d'un paquet Jellyfin Tizen (.wgt) avec le loader QuickPin intégré.
#
# Prérequis :
#   - Node.js 20+
#   - Tizen Studio CLI (`tizen` et `sdb` dans le PATH)
#   - Un profil de certificat configuré dans Tizen Certificate Manager
#     (certificat Samsung pour les TV récentes)
#
# Usage :
#   ./build-tizen.sh                 # branche jellyfin-web par défaut : release-10.11.z
#   JF_WEB_BRANCH=release-10.10.z ./build-tizen.sh
#
set -euo pipefail

JF_WEB_BRANCH="${JF_WEB_BRANCH:-release-10.11.z}"
WORK_DIR="$(cd "$(dirname "$0")" && pwd)/work"

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

echo "==> 1/5 Clonage de jellyfin-web ($JF_WEB_BRANCH)"
if [ ! -d jellyfin-web ]; then
  git clone -b "$JF_WEB_BRANCH" --depth 1 https://github.com/jellyfin/jellyfin-web.git
fi

echo "==> 2/5 Build de jellyfin-web (production)"
cd jellyfin-web
npm ci --no-audit
USE_SYSTEM_FONTS=1 npm run build:production
cd ..

echo "==> 3/5 Injection du loader QuickPin dans dist/index.html"
python3 - <<'PYEOF'
import io, sys

INDEX = "jellyfin-web/dist/index.html"
MARKER = "__quickPinTizenLoader"

# Loader : l'app Tizen est servie en local (file://), le serveur n'est connu
# qu'après l'ajout dans l'app. On lit donc jellyfin_credentials et on charge
# /QuickPin/ClientScript depuis le serveur (les balises <script> ne sont pas
# soumises à CORS). On réessaie tant que le serveur n'est pas connu.
LOADER = """<script>
(function(){
  if (window.__quickPinTizenLoader) return;
  window.__quickPinTizenLoader = true;
  var tries = 0;
  function base(){
    try {
      var raw = localStorage.getItem('jellyfin_credentials');
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || !c.Servers || !c.Servers.length) return null;
      var best = c.Servers[0];
      for (var i = 1; i < c.Servers.length; i++) {
        var a = Date.parse(c.Servers[i].DateLastAccessed || 0) || 0;
        var b = Date.parse(best.DateLastAccessed || 0) || 0;
        if (a > b) best = c.Servers[i];
      }
      var u = best.ManualAddress || best.LocalAddress || best.RemoteAddress || best.Address;
      return u ? String(u).replace(/\\/+$/, '') : null;
    } catch (e) { return null; }
  }
  function load(){
    if (window.__quickPinLoaded) return true;
    var b = base();
    if (!b) return false;
    var s = document.createElement('script');
    s.src = b + '/QuickPin/ClientScript';
    s.defer = true;
    document.head.appendChild(s);
    return true;
  }
  function tick(){
    tries++;
    if (load() || tries > 120) return;
    setTimeout(tick, 1500);
  }
  window.addEventListener('hashchange', load);
  tick();
})();
</script>"""

with io.open(INDEX, "r", encoding="utf-8") as f:
    html = f.read()

if MARKER in html:
    print("    Loader déjà présent, rien à faire.")
    sys.exit(0)

idx = html.lower().rfind("</body>")
if idx < 0:
    print("ERREUR : </body> introuvable dans dist/index.html", file=sys.stderr)
    sys.exit(1)

html = html[:idx] + LOADER + html[idx:]
with io.open(INDEX, "w", encoding="utf-8") as f:
    f.write(html)
print("    Loader QuickPin injecté.")
PYEOF

echo "==> 4/5 Préparation de jellyfin-tizen"
if [ ! -d jellyfin-tizen ]; then
  git clone --depth 1 https://github.com/jellyfin/jellyfin-tizen.git
fi
cd jellyfin-tizen
JELLYFIN_WEB_DIR=../jellyfin-web/dist npm ci --no-audit

echo "==> 5/5 Build du paquet .wgt"
tizen build-web -e ".*" -e gulpfile.babel.js -e README.md -e "node_modules/*" -e "package*.json" -e "yarn.lock"
tizen package -t wgt -o . -- .buildResult

echo
echo "✔ Paquet généré : $WORK_DIR/jellyfin-tizen/Jellyfin.wgt"
echo
echo "Installation sur la TV (mode développeur activé, IP du PC autorisée) :"
echo "  sdb connect IP_DE_LA_TV"
echo "  sdb devices                       # noter l'identifiant de l'appareil"
echo "  tizen install -n Jellyfin.wgt -t IDENTIFIANT_APPAREIL"
