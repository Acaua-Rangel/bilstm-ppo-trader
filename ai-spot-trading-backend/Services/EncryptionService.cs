using System.Security.Cryptography;
using System.Text;

namespace AiSpotTrading.Backend.Services
{
    // AES-256-GCM. Payload format: base64( nonce(12) || tag(16) || ciphertext ).
    public class EncryptionService : IEncryptionService
    {
        private const int NonceSize = 12;
        private const int TagSize = 16;
        private readonly byte[] _key;

        public EncryptionService(IConfiguration config)
        {
            var raw = config["Encryption:Key"]
                ?? Environment.GetEnvironmentVariable("ENCRYPTION_KEY")
                ?? throw new InvalidOperationException("ENCRYPTION_KEY não configurada (base64 de 32 bytes).");

            _key = Convert.FromBase64String(raw);
            if (_key.Length != 32)
                throw new InvalidOperationException("ENCRYPTION_KEY deve ter 32 bytes (256 bits) em base64.");
        }

        public string Encrypt(string plainText)
        {
            var plain = Encoding.UTF8.GetBytes(plainText);
            var nonce = RandomNumberGenerator.GetBytes(NonceSize);
            var cipher = new byte[plain.Length];
            var tag = new byte[TagSize];

            using var aes = new AesGcm(_key, TagSize);
            aes.Encrypt(nonce, plain, cipher, tag);

            var output = new byte[NonceSize + TagSize + cipher.Length];
            Buffer.BlockCopy(nonce, 0, output, 0, NonceSize);
            Buffer.BlockCopy(tag, 0, output, NonceSize, TagSize);
            Buffer.BlockCopy(cipher, 0, output, NonceSize + TagSize, cipher.Length);
            return Convert.ToBase64String(output);
        }

        public string Decrypt(string cipherText)
        {
            var blob = Convert.FromBase64String(cipherText);
            var nonce = new byte[NonceSize];
            var tag = new byte[TagSize];
            var cipher = new byte[blob.Length - NonceSize - TagSize];
            Buffer.BlockCopy(blob, 0, nonce, 0, NonceSize);
            Buffer.BlockCopy(blob, NonceSize, tag, 0, TagSize);
            Buffer.BlockCopy(blob, NonceSize + TagSize, cipher, 0, cipher.Length);

            var plain = new byte[cipher.Length];
            using var aes = new AesGcm(_key, TagSize);
            aes.Decrypt(nonce, cipher, tag, plain);
            return Encoding.UTF8.GetString(plain);
        }
    }
}
