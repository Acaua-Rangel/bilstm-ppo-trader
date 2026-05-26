using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Google.Apis.Auth;
using AiSpotTrading.Backend.DTOs;
using AiSpotTrading.Backend.Models;
using AiSpotTrading.Backend.Repositories;
using AiSpotTrading.Backend.Services;

namespace AiSpotTrading.Backend.Controllers
{
    [ApiController]
    [Route("api/auth")]
    public class AuthController : ControllerBase
    {
        private const string CookieName = "ast_session";

        private readonly IUserRepository _userRepo;
        private readonly IExchangeAccountRepository _accountRepo;
        private readonly IJwtService _jwt;
        private readonly IConfiguration _config;
        private readonly ILogger<AuthController> _logger;

        public AuthController(
            IUserRepository userRepo,
            IExchangeAccountRepository accountRepo,
            IJwtService jwt,
            IConfiguration config,
            ILogger<AuthController> logger)
        {
            _userRepo = userRepo;
            _accountRepo = accountRepo;
            _jwt = jwt;
            _config = config;
            _logger = logger;
        }

        [HttpPost("google")]
        public async Task<IActionResult> GoogleLogin([FromBody] GoogleLoginRequestDto dto)
        {
            var clientId = _config["Google:ClientId"]
                ?? Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID");
            if (string.IsNullOrEmpty(clientId))
                return StatusCode(500, new { error = "Google Client ID não configurado." });

            GoogleJsonWebSignature.Payload payload;
            try
            {
                payload = await GoogleJsonWebSignature.ValidateAsync(dto.IdToken, new GoogleJsonWebSignature.ValidationSettings
                {
                    Audience = new[] { clientId }
                });
            }
            catch (InvalidJwtException ex)
            {
                _logger.LogWarning(ex, "ID token do Google inválido.");
                return Unauthorized(new { error = "ID token inválido." });
            }

            var user = await _userRepo.GetByGoogleSubAsync(payload.Subject);
            if (user == null)
            {
                user = new User
                {
                    GoogleSub = payload.Subject,
                    Email = payload.Email,
                    Name = payload.Name,
                    AvatarUrl = payload.Picture
                };
                await _userRepo.CreateUserAsync(user);
            }
            else
            {
                // Refresh perfil
                user.Email = payload.Email;
                user.Name = payload.Name;
                user.AvatarUrl = payload.Picture;
                await _userRepo.UpdateUserAsync(user);
            }

            var token = _jwt.CreateToken(user);
            SetSessionCookie(token);

            return Ok(await BuildMeAsync(user));
        }

        [Authorize]
        [HttpGet("me")]
        public async Task<IActionResult> Me()
        {
            var user = await GetCurrentUserAsync();
            if (user == null) return Unauthorized();
            return Ok(await BuildMeAsync(user));
        }

        [Authorize]
        [HttpPost("logout")]
        public IActionResult Logout()
        {
            Response.Cookies.Delete(CookieName);
            return NoContent();
        }

        private void SetSessionCookie(string token)
        {
            var secure = !string.Equals(_config["Cookie:Secure"], "false", StringComparison.OrdinalIgnoreCase);
            Response.Cookies.Append(CookieName, token, new CookieOptions
            {
                HttpOnly = true,
                Secure = secure,
                SameSite = SameSiteMode.Lax,
                Expires = DateTimeOffset.UtcNow.AddDays(7),
                Path = "/"
            });
        }

        private async Task<User?> GetCurrentUserAsync()
        {
            var sub = User.FindFirstValue(ClaimTypes.NameIdentifier)
                   ?? User.FindFirstValue("sub");
            if (!int.TryParse(sub, out var id)) return null;
            return await _userRepo.GetByIdAsync(id);
        }

        private async Task<MeResponseDto> BuildMeAsync(User user)
        {
            var accounts = await _accountRepo.GetByUserIdAsync(user.Id);
            return new MeResponseDto
            {
                Id = user.Id,
                Email = user.Email,
                Name = user.Name,
                AvatarUrl = user.AvatarUrl,
                BinanceUid = user.BinanceUid,
                HasExchangeAccount = accounts.Any()
            };
        }
    }
}
