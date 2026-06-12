using System;
using System.Security.Cryptography;
using System.Text;

namespace Jellyfin.Plugin.QuickPin
{
    /// <summary>
    /// Hachage des codes PIN : PBKDF2-SHA256, 100 000 itérations, sel de 16 octets.
    /// Comparaison en temps constant pour éviter les attaques temporelles.
    /// </summary>
    public static class PinHasher
    {
        private const int SaltSize = 16;
        private const int HashSize = 32;
        private const int Iterations = 100_000;

        /// <summary>
        /// Hache un PIN et retourne (hash base64, sel base64).
        /// </summary>
        public static (string Hash, string Salt) Hash(string pin)
        {
            var salt = RandomNumberGenerator.GetBytes(SaltSize);
            var hash = Rfc2898DeriveBytes.Pbkdf2(
                Encoding.UTF8.GetBytes(pin),
                salt,
                Iterations,
                HashAlgorithmName.SHA256,
                HashSize);

            return (Convert.ToBase64String(hash), Convert.ToBase64String(salt));
        }

        /// <summary>
        /// Vérifie un PIN contre un hash + sel stockés. Retourne false sur toute anomalie.
        /// </summary>
        public static bool Verify(string pin, string storedHash, string storedSalt)
        {
            if (string.IsNullOrEmpty(pin) || string.IsNullOrEmpty(storedHash) || string.IsNullOrEmpty(storedSalt))
            {
                return false;
            }

            try
            {
                var salt = Convert.FromBase64String(storedSalt);
                var expected = Convert.FromBase64String(storedHash);

                var actual = Rfc2898DeriveBytes.Pbkdf2(
                    Encoding.UTF8.GetBytes(pin),
                    salt,
                    Iterations,
                    HashAlgorithmName.SHA256,
                    expected.Length);

                return CryptographicOperations.FixedTimeEquals(actual, expected);
            }
            catch (FormatException)
            {
                return false;
            }
        }
    }
}
