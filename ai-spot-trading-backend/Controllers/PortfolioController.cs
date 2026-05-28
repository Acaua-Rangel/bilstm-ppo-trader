using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using AiSpotTrading.Backend.DTOs;
using AiSpotTrading.Backend.Repositories;

namespace AiSpotTrading.Backend.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/portfolio")]
    public class PortfolioController : ControllerBase
    {
        private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };

        private readonly IExchangeAccountRepository _accountRepo;
        private readonly ITradeRepository _tradeRepo;
        private readonly ILogger<PortfolioController> _logger;

        public PortfolioController(
            IExchangeAccountRepository accountRepo,
            ITradeRepository tradeRepo,
            ILogger<PortfolioController> logger)
        {
            _accountRepo = accountRepo;
            _tradeRepo = tradeRepo;
            _logger = logger;
        }

        // GET /api/portfolio  → desempenho por ExchangeAccount do usuário autenticado.
        // Valor estimado = saldo inicial + PnL realizado (SELLs fechados) +
        //                  PnL não realizado da posição BUY em aberto (se houver).
        [HttpGet]
        public async Task<IActionResult> Get()
        {
            var sub = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
            if (!int.TryParse(sub, out var userId)) return Unauthorized();

            var accounts = (await _accountRepo.GetByUserIdAsync(userId)).ToList();
            if (accounts.Count == 0) return Ok(Array.Empty<PortfolioDto>());

            var uids = accounts
                .Select(a => a.BinanceUid ?? string.Empty)
                .Where(u => !string.IsNullOrEmpty(u))
                .Distinct()
                .ToList();
            var allTrades = (await _tradeRepo.GetByBinanceUidsAsync(uids)).ToList();
            var currentPrice = await GetCurrentBtcPriceAsync() ?? 0m;

            var dtos = accounts.Select(acc =>
            {
                // Considera apenas trades a partir da última alteração de saldo (novo baseline).
                var accTrades = allTrades
                    .Where(t => t.BinanceUid == acc.BinanceUid && t.Timestamp >= acc.BalanceUpdatedAt)
                    .ToList();

                // PnL realizado: apenas SELLs com amount > 0 (trades reais; ignora sinais fantasmas).
                var realized = accTrades
                    .Where(t => t.Action == "SELL" && t.Amount > 0)
                    .Sum(t => t.PnL);

                // Posição aberta: último BUY/SELL real é um BUY.
                var lastReal = accTrades
                    .Where(t => (t.Action == "BUY" || t.Action == "SELL") && t.Amount > 0)
                    .OrderByDescending(t => t.Timestamp)
                    .FirstOrDefault();

                decimal unrealized = 0m;
                bool hasOpen = false;
                decimal? openBuyPrice = null;
                decimal? openAmount = null;

                if (lastReal != null && lastReal.Action == "BUY" && currentPrice > 0)
                {
                    hasOpen = true;
                    openBuyPrice = lastReal.Price;
                    openAmount = lastReal.Amount;
                    unrealized = (currentPrice - lastReal.Price) * lastReal.Amount;
                }

                return new PortfolioDto
                {
                    ExchangeAccountId = acc.Id,
                    BinanceUid = acc.BinanceUid ?? string.Empty,
                    IsPaperTrading = acc.IsPaperTrading,
                    InitialBalance = acc.AllocatedBalance,
                    RealizedPnL = realized,
                    UnrealizedPnL = unrealized,
                    EstimatedTotal = acc.AllocatedBalance + realized + unrealized,
                    CurrentPrice = currentPrice,
                    HasOpenPosition = hasOpen,
                    OpenBuyPrice = openBuyPrice,
                    OpenAmount = openAmount,
                };
            });

            return Ok(dtos);
        }

        // Cota BTC com fallback Bybit → Binance.US. FDUSD/USDT/USD ~ 1:1 (todos stablecoins de US$).
        private async Task<decimal?> GetCurrentBtcPriceAsync()
        {
            foreach (var host in new[] { "api.bybit.com", "api.bytick.com" })
            {
                try
                {
                    using var resp = await _http.GetAsync(
                        $"https://{host}/v5/market/tickers?category=spot&symbol=BTCUSDT");
                    if (!resp.IsSuccessStatusCode) continue;
                    var raw = await resp.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(raw);
                    if (doc.RootElement.GetProperty("retCode").GetInt32() != 0) continue;
                    var price = doc.RootElement
                        .GetProperty("result").GetProperty("list")[0]
                        .GetProperty("lastPrice").GetString();
                    if (!string.IsNullOrEmpty(price))
                        return decimal.Parse(price, CultureInfo.InvariantCulture);
                }
                catch (Exception ex) { _logger.LogWarning(ex, "[Bybit ticker] Falha em {Host}", host); }
            }

            try
            {
                using var resp = await _http.GetAsync(
                    "https://api.binance.us/api/v3/ticker/price?symbol=BTCUSD");
                if (resp.IsSuccessStatusCode)
                {
                    var raw = await resp.Content.ReadAsStringAsync();
                    using var doc = JsonDocument.Parse(raw);
                    var price = doc.RootElement.GetProperty("price").GetString();
                    if (!string.IsNullOrEmpty(price))
                        return decimal.Parse(price, CultureInfo.InvariantCulture);
                }
            }
            catch (Exception ex) { _logger.LogWarning(ex, "[Binance.US ticker] Falha"); }

            return null;
        }
    }
}
