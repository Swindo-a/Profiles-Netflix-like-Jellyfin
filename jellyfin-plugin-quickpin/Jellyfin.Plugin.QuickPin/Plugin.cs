using System;
using System.Collections.Generic;
using System.IO;
using Jellyfin.Plugin.QuickPin.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.QuickPin
{
    /// <summary>
    /// Plugin QuickPin : remplace l'écran de connexion par une sélection
    /// de profils + code PIN, pensé pour les TV (navigation télécommande).
    /// </summary>
    public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
    {
        private readonly IApplicationPaths _applicationPaths;
        private readonly ILogger<Plugin> _logger;

        public Plugin(
            IApplicationPaths applicationPaths,
            IXmlSerializer xmlSerializer,
            ILogger<Plugin> logger)
            : base(applicationPaths, xmlSerializer)
        {
            Instance = this;
            _applicationPaths = applicationPaths;
            _logger = logger;

            if (Configuration.InjectScript)
            {
                InjectClientScript();
            }
        }

        /// <summary>
        /// Instance statique du plugin (pattern standard Jellyfin).
        /// </summary>
        public static Plugin? Instance { get; private set; }

        /// <inheritdoc />
        public override string Name => "QuickPin";

        /// <inheritdoc />
        public override Guid Id => Guid.Parse("ba2facb8-c27e-4420-bda8-42197ded798a");

        /// <inheritdoc />
        public override string Description =>
            "Écran de connexion par profils + code PIN, optimisé TV (Samsung/Tizen, navigateur, etc.).";

        /// <inheritdoc />
        public IEnumerable<PluginPageInfo> GetPages()
        {
            return new[]
            {
                new PluginPageInfo
                {
                    Name = "QuickPin",
                    EmbeddedResourcePath = string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "{0}.Configuration.configPage.html",
                        GetType().Namespace)
                }
            };
        }

        /// <summary>
        /// Injecte la balise script QuickPin dans l'index.html du client web
        /// servi par le serveur. Idempotent : ne fait rien si la balise existe déjà.
        /// Le chemin est relatif ("QuickPin/ClientScript") afin de résoudre
        /// correctement même quand Jellyfin est servi sous un sous-chemin.
        /// </summary>
        internal void InjectClientScript()
        {
            try
            {
                var webPath = _applicationPaths.WebPath;
                if (string.IsNullOrEmpty(webPath))
                {
                    _logger.LogWarning("[QuickPin] WebPath introuvable, injection du script ignorée.");
                    return;
                }

                var indexPath = Path.Combine(webPath, "index.html");
                if (!File.Exists(indexPath))
                {
                    _logger.LogWarning("[QuickPin] {Index} introuvable, injection du script ignorée.", indexPath);
                    return;
                }

                var html = File.ReadAllText(indexPath);

                const string Marker = "src=\"QuickPin/ClientScript\"";
                if (html.Contains(Marker, StringComparison.OrdinalIgnoreCase))
                {
                    return; // déjà injecté
                }

                const string BodyClose = "</body>";
                var idx = html.LastIndexOf(BodyClose, StringComparison.OrdinalIgnoreCase);
                if (idx < 0)
                {
                    _logger.LogWarning("[QuickPin] Balise </body> introuvable dans index.html, injection annulée.");
                    return;
                }

                const string ScriptTag =
                    "<script plugin=\"QuickPin\" defer=\"defer\" src=\"QuickPin/ClientScript\"></script>";

                html = html.Insert(idx, ScriptTag);
                File.WriteAllText(indexPath, html);
                _logger.LogInformation("[QuickPin] Script client injecté dans {Index}.", indexPath);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "[QuickPin] Impossible d'injecter le script dans index.html. " +
                    "Vérifiez que le serveur a les droits d'écriture sur le dossier web " +
                    "(fréquent en Docker : montez jellyfin-web en écriture ou injectez la balise manuellement).");
            }
        }
    }
}
