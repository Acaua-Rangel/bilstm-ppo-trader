using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using AiSpotTrading.Backend.DTOs;
using AiSpotTrading.Backend.Repositories;

namespace AiSpotTrading.Backend.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/trades")]
    public class TradeController : ControllerBase
    {
        private readonly ITradeRepository _tradeRepo;
        private readonly IExchangeAccountRepository _accountRepo;

        public TradeController(ITradeRepository tradeRepo, IExchangeAccountRepository accountRepo)
        {
            _tradeRepo = tradeRepo;
            _accountRepo = accountRepo;
        }

        // GET /api/trades/recent?hours=24
        [HttpGet("recent")]
        public async Task<IActionResult> Recent([FromQuery] int hours = 24)
        {
            if (hours <= 0 || hours > 24 * 30) hours = 24;

            var sub = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
            if (!int.TryParse(sub, out var userId)) return Unauthorized();

            // Pega os BinanceUids das ExchangeAccounts do usuário (incluindo string vazia,
            // caso o usuário não tenha preenchido o campo BinanceUid no onboarding).
            var accounts = await _accountRepo.GetByUserIdAsync(userId);
            var binanceUids = accounts.Select(a => a.BinanceUid ?? string.Empty).Distinct().ToList();
            if (binanceUids.Count == 0)
                return Ok(Array.Empty<TradeDecisionDto>());

            var since = DateTime.UtcNow.AddHours(-hours);
            var trades = await _tradeRepo.GetRecentByBinanceUidsAsync(binanceUids, since);

            var dtos = trades.Select(t => new TradeDecisionDto
            {
                Id = t.Id,
                Action = t.Action,
                Price = t.Price,
                Amount = t.Amount,
                Adx = t.Adx,
                PnL = t.PnL,
                Type = t.Type,
                Timestamp = new DateTimeOffset(DateTime.SpecifyKind(t.Timestamp, DateTimeKind.Utc)).ToUnixTimeSeconds(),
            });

            return Ok(dtos);
        }
    }
}
