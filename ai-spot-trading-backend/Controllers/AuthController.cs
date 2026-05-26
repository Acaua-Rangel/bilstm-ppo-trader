using Microsoft.AspNetCore.Mvc;
using System.Threading.Tasks;
using AiSpotTrading.Backend.DTOs;
using AiSpotTrading.Backend.Repositories;
using AiSpotTrading.Backend.Models;

namespace AiSpotTrading.Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly IUserRepository _userRepo;
        private readonly IExchangeAccountRepository _accountRepo;

        public AuthController(IUserRepository userRepo, IExchangeAccountRepository accountRepo)
        {
            _userRepo = userRepo;
            _accountRepo = accountRepo;
        }

        [HttpPost("binance-login")]
        public async Task<IActionResult> BinanceLogin([FromBody] BinanceOAuthRequestDto request)
        {
            // MOCK: Em produção, o backend chamaria a Binance OAuth API para trocar o `request.Code`
            // pelo Token de Acesso e para criar o Binance Fast API Key.
            // Para efeitos de desenvolvimento do Beta, vamos mocar a criação:
            
            var mockUid = "BINANCE_UID_" + new Random().Next(1000, 9999);
            
            var user = await _userRepo.GetUserByBinanceUidAsync(mockUid);
            if (user == null)
            {
                user = new User 
                { 
                    BinanceUid = mockUid,
                    Name = "Trader Beta",
                    AvatarUrl = ""
                };
                await _userRepo.CreateUserAsync(user);

                var account = new ExchangeAccount
                {
                    BinanceUid = mockUid,
                    EncryptedApiKey = "mocked_encrypted_api_key",
                    EncryptedApiSecret = "mocked_encrypted_secret",
                    AllocatedBalance = 1000, // Saldo inicial paper
                    IsPaperTrading = true,
                    IsActive = true
                };
                await _accountRepo.CreateAccountAsync(account);
            }

            return Ok(new { Message = "Login efetuado com sucesso via Binance Fast API.", BinanceUid = user.BinanceUid });
        }

        [HttpPut("config/{binanceUid}")]
        public async Task<IActionResult> UpdateConfig(string binanceUid, [FromBody] UserConfigUpdateDto dto)
        {
            var account = await _accountRepo.GetAccountByBinanceUidAsync(binanceUid);
            if (account == null) return NotFound("Conta não encontrada.");

            account.AllocatedBalance = dto.AllocatedBalance;
            account.IsPaperTrading = dto.IsPaperTrading;
            account.IsActive = dto.IsActive;

            await _accountRepo.UpdateAccountAsync(account);
            return Ok(account);
        }
    }
}
