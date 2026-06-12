using System;
using System.Collections.Generic;
using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.QuickPin.Configuration
{
    /// <summary>
    /// Un profil affiché sur l'écran de connexion QuickPin.
    /// Le PIN n'est jamais stocké en clair : hash PBKDF2 + sel.
    /// </summary>
    public class PinProfile
    {
        /// <summary>Identifiant de l'utilisateur Jellyfin.</summary>
        public Guid UserId { get; set; }

        /// <summary>Hash PBKDF2 (base64) du code PIN.</summary>
        public string PinHash { get; set; } = string.Empty;

        /// <summary>Sel (base64) utilisé pour le hash.</summary>
        public string PinSalt { get; set; } = string.Empty;
    }

    /// <summary>
    /// Configuration du plugin QuickPin.
    /// </summary>
    public class PluginConfiguration : BasePluginConfiguration
    {
        /// <summary>Titre affiché au-dessus des profils.</summary>
        public string Title { get; set; } = "Qui est-ce ?";

        /// <summary>Longueur du PIN (4 à 8 chiffres, identique pour tous les profils).</summary>
        public int PinLength { get; set; } = 4;

        /// <summary>Afficher un lien discret vers la connexion classique (recommandé).</summary>
        public bool ShowClassicLoginLink { get; set; } = true;

        /// <summary>Injecter automatiquement le script dans l'index.html du client web servi par le serveur.</summary>
        public bool InjectScript { get; set; } = true;

        /// <summary>Nombre d'échecs avant verrouillage temporaire.</summary>
        public int MaxAttempts { get; set; } = 5;

        /// <summary>Durée du verrouillage en secondes après MaxAttempts échecs.</summary>
        public int LockoutSeconds { get; set; } = 60;

        /// <summary>Profils affichés sur l'écran de connexion.</summary>
        public List<PinProfile> Profiles { get; set; } = new List<PinProfile>();
    }
}
