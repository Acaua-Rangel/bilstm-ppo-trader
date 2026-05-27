using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using AiSpotTrading.Backend.DTOs;
using AiSpotTrading.Backend.Models;
using AiSpotTrading.Backend.Repositories;
using AiSpotTrading.Backend.Services;

namespace AiSpotTrading.Backend.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/exchange-accounts")]
    public class ExchangeAccountsController : ControllerBase
    {
        private readonly IExchangeAccountRepository _accountRepo;
        private readonly IUserRepository _userRepo;
        private readonly IEncryptionService _crypto;

        public ExchangeAccountsController(
            IExchangeAccountRepository accountRepo,
            IUserRepository userRepo,
            IEncryptionService crypto)
        {
            _accountRepo = accountRepo;
            _userRepo = userRepo;
            _crypto = crypto;
        }

        [HttpGet]
        public async Task<IActionResult> List()
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            var accounts = await _accountRepo.GetByUserIdAsync(userId.Value);
            return Ok(accounts.Select(ToDto));
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CreateExchangeAccountDto dto)
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            var hasKeys = !string.IsNullOrWhiteSpace(dto.ApiKey) && !string.IsNullOrWhiteSpace(dto.ApiSecret);

            if (!dto.IsPaperTrading && !hasKeys)
                return BadRequest(new { error = "API Key e Secret são obrigatórios para operar com dinheiro real." });

            var account = new ExchangeAccount
            {
                UserId = userId.Value,
                BinanceUid = dto.BinanceUid ?? string.Empty,
                EncryptedApiKey = hasKeys ? _crypto.Encrypt(dto.ApiKey) : string.Empty,
                EncryptedApiSecret = hasKeys ? _crypto.Encrypt(dto.ApiSecret) : string.Empty,
                AllocatedBalance = dto.AllocatedBalance,
                IsPaperTrading = dto.IsPaperTrading,
                IsActive = true
            };
            await _accountRepo.CreateAccountAsync(account);

            if (!string.IsNullOrEmpty(dto.BinanceUid))
            {
                var user = await _userRepo.GetByIdAsync(userId.Value);
                if (user != null && string.IsNullOrEmpty(user.BinanceUid))
                {
                    user.BinanceUid = dto.BinanceUid;
                    await _userRepo.UpdateUserAsync(user);
                }
            }

            return CreatedAtAction(nameof(List), new { id = account.Id }, ToDto(account));
        }

        [HttpPut("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] UpdateExchangeAccountDto dto)
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            var account = await _accountRepo.GetByIdAsync(id);
            if (account == null || account.UserId != userId.Value) return NotFound();

            if (!dto.IsPaperTrading && string.IsNullOrEmpty(account.EncryptedApiKey))
                return BadRequest(new { error = "Cadastre suas API keys da Binance antes de operar com dinheiro real." });

            account.AllocatedBalance = dto.AllocatedBalance;
            account.IsPaperTrading = dto.IsPaperTrading;
            account.IsActive = dto.IsActive;
            await _accountRepo.UpdateAccountAsync(account);

            return Ok(ToDto(account));
        }

        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            var userId = GetUserId();
            if (userId == null) return Unauthorized();

            var account = await _accountRepo.GetByIdAsync(id);
            if (account == null || account.UserId != userId.Value) return NotFound();

            await _accountRepo.DeleteAsync(account);
            return NoContent();
        }

        private int? GetUserId()
        {
            var sub = User.FindFirstValue(ClaimTypes.NameIdentifier)
                   ?? User.FindFirstValue("sub");
            return int.TryParse(sub, out var id) ? id : null;
        }

        private ExchangeAccountResponseDto ToDto(ExchangeAccount a)
        {
            string masked;
            if (string.IsNullOrEmpty(a.EncryptedApiKey))
            {
                masked = string.Empty;
            }
            else
            {
                try
                {
                    var plain = _crypto.Decrypt(a.EncryptedApiKey);
                    masked = plain.Length <= 8
                        ? new string('•', plain.Length)
                        : $"{plain[..4]}••••{plain[^4..]}";
                }
                catch
                {
                    masked = "••••••••";
                }
            }

            return new ExchangeAccountResponseDto
            {
                Id = a.Id,
                BinanceUid = a.BinanceUid,
                AllocatedBalance = a.AllocatedBalance,
                IsPaperTrading = a.IsPaperTrading,
                IsActive = a.IsActive,
                ApiKeyMasked = masked,
                CreatedAt = a.CreatedAt
            };
        }
    }
}
