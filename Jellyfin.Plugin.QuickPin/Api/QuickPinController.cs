using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.QuickPin.Configuration;
using MediaBrowser.Controller.Authentication;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.QuickPin.Api
{
    /// <summary>Corps de la requête d'authentification par PIN.</summary>
    public class PinAuthRequest
    {
        public Guid UserId { get; set; }

        public string Pin { get; set; } = string.Empty;

        public string? DeviceId { get; set; }

        public string? DeviceName { get; set; }

        public string? App { get; set; }

        public string? AppVersion { get; set; }
    }

    /// <summary>Profil envoyé au formulaire d'admin (sans hash).</summary>
    public class AdminProfileDto
    {
        public Guid UserId { get; set; }

        public string? Pin { get; set; }
    }

    /// <summary>Corps de sauvegarde de la configuration admin.</summary>
    public class AdminSaveRequest
    {
        public string? Title { get; set; }

        public int PinLength { get; set; } = 4;

        public bool ShowClassicLoginLink { get; set; } = true;

        public bool InjectScript { get; set; } = true;

        public List<AdminProfileDto> Profiles { get; set; } = new List<AdminProfileDto>();
    }

    /// <summary>
    /// Endpoints QuickPin : liste publique des profils, authentification par PIN,
    /// script client, et configuration admin.
    /// </summary>
    [ApiController]
    [Route("QuickPin")]
    public class QuickPinController : ControllerBase
    {
        private const int MaxProfiles = 6;

        // Anti-bruteforce en mémoire : clé "userId|ip" -> (échecs, verrou jusqu'à).
        private static readonly ConcurrentDictionary<string, (int Failures, DateTimeOffset LockedUntil)> _attempts =
            new ConcurrentDictionary<string, (int, DateTimeOffset)>();

        private readonly ISessionManager _sessionManager;
        private readonly IUserManager _userManager;
        private readonly ILogger<QuickPinController> _logger;

        public QuickPinController(
            ISessionManager sessionManager,
            IUserManager userManager,
            ILogger<QuickPinController> logger)
        {
            _sessionManager = sessionManager;
            _userManager = userManager;
            _logger = logger;
        }

        private static PluginConfiguration Config =>
            Plugin.Instance?.Configuration ?? new PluginConfiguration();

        /// <summary>
        /// Profils configurés, exposés anonymement pour l'écran de connexion.
        /// Ne retourne que l'id, le nom et la présence d'un avatar.
        /// </summary>
        [HttpGet("Profiles")]
        [AllowAnonymous]
        public ActionResult GetProfiles()
        {
            var config = Config;
            var profiles = new List<object>();

            foreach (var profile in config.Profiles)
            {
                var user = _userManager.GetUserById(profile.UserId);
                if (user is null || user.HasPermission(PermissionKind.IsDisabled))
                {
                    continue;
                }

                profiles.Add(new
                {
                    Id = user.Id,
                    Name = user.Username,
                    HasImage = user.ProfileImage is not null
                });
            }

            return Ok(new
            {
                Title = config.Title,
                PinLength = config.PinLength,
                ShowClassicLoginLink = config.ShowClassicLoginLink,
                Profiles = profiles
            });
        }

        /// <summary>
        /// Authentifie un profil avec son code PIN et retourne un AuthenticationResult
        /// Jellyfin standard (AccessToken, User, SessionInfo, ServerId).
        /// </summary>
        [HttpPost("Authenticate")]
        [AllowAnonymous]
        public async Task<ActionResult> Authenticate([FromBody] PinAuthRequest request)
        {
            var config = Config;
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var key = request.UserId.ToString("N") + "|" + ip;

            // Verrouillage temporaire ?
            if (_attempts.TryGetValue(key, out var state) && state.LockedUntil > DateTimeOffset.UtcNow)
            {
                var retryAfter = (int)Math.Ceiling((state.LockedUntil - DateTimeOffset.UtcNow).TotalSeconds);
                Response.Headers["Retry-After"] = retryAfter.ToString(System.Globalization.CultureInfo.InvariantCulture);
                return StatusCode(StatusCodes.Status429TooManyRequests, new
                {
                    Message = "Trop de tentatives. Réessayez plus tard.",
                    RetryAfterSeconds = retryAfter
                });
            }

            var profile = config.Profiles.FirstOrDefault(p => p.UserId == request.UserId);
            var user = profile is null ? null : _userManager.GetUserById(profile.UserId);

            var valid =
                profile is not null
                && user is not null
                && !user.HasPermission(PermissionKind.IsDisabled)
                && PinHasher.Verify(request.Pin ?? string.Empty, profile.PinHash, profile.PinSalt);

            if (!valid)
            {
                RegisterFailure(key, config);
                _logger.LogWarning("[QuickPin] Échec PIN pour {UserId} depuis {Ip}.", request.UserId, ip);
                return Unauthorized(new { Message = "Code PIN incorrect." });
            }

            _attempts.TryRemove(key, out _);

            var pluginVersion =
                Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "1.0.0.0";

            var authRequest = new AuthenticationRequest
            {
                UserId = user!.Id,
                Username = user.Username,
                App = string.IsNullOrWhiteSpace(request.App) ? "Jellyfin Web (QuickPin)" : request.App,
                AppVersion = string.IsNullOrWhiteSpace(request.AppVersion) ? pluginVersion : request.AppVersion,
                DeviceId = string.IsNullOrWhiteSpace(request.DeviceId)
                    ? Guid.NewGuid().ToString("N")
                    : request.DeviceId,
                DeviceName = string.IsNullOrWhiteSpace(request.DeviceName) ? "QuickPin" : request.DeviceName,
                RemoteEndPoint = ip
            };

            try
            {
                AuthenticationResult result = await _sessionManager
                    .AuthenticateDirect(authRequest)
                    .ConfigureAwait(false);

                _logger.LogInformation(
                    "[QuickPin] Connexion PIN réussie pour {User} depuis {Ip}.",
                    user.Username,
                    ip);

                return Ok(result);
            }
            catch (Exception ex)
            {
                // SecurityException (appareil non autorisé, max sessions), etc.
                _logger.LogWarning(ex, "[QuickPin] AuthenticateDirect a échoué pour {User}.", user.Username);
                return Unauthorized(new { Message = "Connexion refusée par le serveur." });
            }
        }

        /// <summary>
        /// Sert le script client embarqué. Double route : "/QuickPin/ClientScript"
        /// et "/web/QuickPin/ClientScript" (résolution relative depuis index.html).
        /// </summary>
        [HttpGet("ClientScript")]
        [HttpGet("/web/QuickPin/ClientScript")]
        [AllowAnonymous]
        public ActionResult GetClientScript()
        {
            var assembly = Assembly.GetExecutingAssembly();
            var stream = assembly.GetManifestResourceStream("Jellyfin.Plugin.QuickPin.Web.quickpin.js");
            if (stream is null)
            {
                return NotFound();
            }

            Response.Headers["Cache-Control"] = "no-cache";
            return new FileStreamResult(stream, "application/javascript");
        }

        /// <summary>
        /// Données pour la page de configuration admin : réglages, profils (sans hash)
        /// et liste de tous les utilisateurs du serveur.
        /// </summary>
        [HttpGet("AdminInfo")]
        [Authorize(Policy = "RequiresElevation")]
        public ActionResult GetAdminInfo()
        {
            var config = Config;

            var users = _userManager.GetUsers()
                .Select(u => new { Id = u.Id, Name = u.Username })
                .OrderBy(u => u.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            var profiles = config.Profiles
                .Select(p => new
                {
                    UserId = p.UserId,
                    HasPin = !string.IsNullOrEmpty(p.PinHash)
                })
                .ToList();

            return Ok(new
            {
                Title = config.Title,
                PinLength = config.PinLength,
                ShowClassicLoginLink = config.ShowClassicLoginLink,
                InjectScript = config.InjectScript,
                Profiles = profiles,
                Users = users
            });
        }

        /// <summary>
        /// Sauvegarde la configuration depuis la page admin. Les PIN fournis sont
        /// hachés côté serveur ; un PIN vide conserve le hash existant.
        /// </summary>
        [HttpPost("AdminInfo")]
        [Authorize(Policy = "RequiresElevation")]
        public ActionResult SaveAdminInfo([FromBody] AdminSaveRequest request)
        {
            var plugin = Plugin.Instance;
            if (plugin is null)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new { Message = "Plugin non initialisé." });
            }

            var config = plugin.Configuration;

            var pinLength = Math.Clamp(request.PinLength, 4, 8);
            var pinLengthChanged = pinLength != config.PinLength;

            if (request.Profiles is null || request.Profiles.Count == 0)
            {
                return BadRequest(new { Message = "Ajoutez au moins un profil." });
            }

            if (request.Profiles.Count > MaxProfiles)
            {
                return BadRequest(new { Message = $"Maximum {MaxProfiles} profils." });
            }

            var seen = new HashSet<Guid>();
            var newProfiles = new List<PinProfile>();

            foreach (var dto in request.Profiles)
            {
                if (dto.UserId == Guid.Empty || !seen.Add(dto.UserId))
                {
                    continue; // ligne vide ou doublon
                }

                var user = _userManager.GetUserById(dto.UserId);
                if (user is null)
                {
                    return BadRequest(new { Message = "Un des utilisateurs sélectionnés n'existe pas." });
                }

                var existing = config.Profiles.FirstOrDefault(p => p.UserId == dto.UserId);

                if (!string.IsNullOrEmpty(dto.Pin))
                {
                    if (dto.Pin.Length != pinLength || !dto.Pin.All(char.IsAsciiDigit))
                    {
                        return BadRequest(new
                        {
                            Message = $"Le PIN de « {user.Username} » doit contenir exactement {pinLength} chiffres."
                        });
                    }

                    var (hash, salt) = PinHasher.Hash(dto.Pin);
                    newProfiles.Add(new PinProfile { UserId = dto.UserId, PinHash = hash, PinSalt = salt });
                }
                else if (existing is not null && !string.IsNullOrEmpty(existing.PinHash) && !pinLengthChanged)
                {
                    // PIN inchangé : on conserve le hash existant.
                    newProfiles.Add(existing);
                }
                else if (pinLengthChanged)
                {
                    return BadRequest(new
                    {
                        Message = "La longueur du PIN a changé : ressaisissez le PIN de chaque profil."
                    });
                }
                else
                {
                    return BadRequest(new
                    {
                        Message = $"Définissez un PIN pour « {user.Username} »."
                    });
                }
            }

            if (newProfiles.Count == 0)
            {
                return BadRequest(new { Message = "Ajoutez au moins un profil valide." });
            }

            config.Title = string.IsNullOrWhiteSpace(request.Title) ? "Qui est-ce ?" : request.Title.Trim();
            config.PinLength = pinLength;
            config.ShowClassicLoginLink = request.ShowClassicLoginLink;
            config.InjectScript = request.InjectScript;
            config.Profiles = newProfiles;

            plugin.SaveConfiguration();

            if (config.InjectScript)
            {
                plugin.InjectClientScript();
            }

            return Ok(new { Message = "Configuration enregistrée." });
        }

        private static void RegisterFailure(string key, PluginConfiguration config)
        {
            var maxAttempts = Math.Max(1, config.MaxAttempts);
            var lockoutSeconds = Math.Max(5, config.LockoutSeconds);

            _attempts.AddOrUpdate(
                key,
                _ => (1, DateTimeOffset.MinValue),
                (_, current) =>
                {
                    var failures = current.Failures + 1;
                    return failures >= maxAttempts
                        ? (0, DateTimeOffset.UtcNow.AddSeconds(lockoutSeconds))
                        : (failures, DateTimeOffset.MinValue);
                });
        }
    }
}
