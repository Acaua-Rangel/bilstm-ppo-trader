using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using AiSpotTrading.Backend.Models;
using Microsoft.IdentityModel.Tokens;

namespace AiSpotTrading.Backend.Services
{
    public class JwtService : IJwtService
    {
        private readonly string _issuer;
        private readonly string _audience;
        private readonly SymmetricSecurityKey _signingKey;
        private readonly int _expiryDays;

        public JwtService(IConfiguration config)
        {
            _issuer = config["Jwt:Issuer"] ?? "AiSpotTrading";
            _audience = config["Jwt:Audience"] ?? "AiSpotTrading.Frontend";
            _expiryDays = int.TryParse(config["Jwt:ExpiryDays"], out var d) ? d : 7;

            var secret = config["Jwt:Secret"]
                ?? Environment.GetEnvironmentVariable("JWT_SECRET")
                ?? throw new InvalidOperationException("JWT_SECRET não configurado.");
            if (secret.Length < 32)
                throw new InvalidOperationException("JWT_SECRET deve ter pelo menos 32 caracteres.");

            _signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        }

        public string CreateToken(User user)
        {
            var claims = new List<Claim>
            {
                new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new("googleSub", user.GoogleSub),
                new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            };
            if (!string.IsNullOrEmpty(user.Email))
                claims.Add(new Claim(JwtRegisteredClaimNames.Email, user.Email));
            if (!string.IsNullOrEmpty(user.Name))
                claims.Add(new Claim("name", user.Name));

            var creds = new SigningCredentials(_signingKey, SecurityAlgorithms.HmacSha256);
            var token = new JwtSecurityToken(
                issuer: _issuer,
                audience: _audience,
                claims: claims,
                expires: DateTime.UtcNow.AddDays(_expiryDays),
                signingCredentials: creds);

            return new JwtSecurityTokenHandler().WriteToken(token);
        }
    }
}
