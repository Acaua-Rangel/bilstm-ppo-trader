using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using AiSpotTrading.Backend.DTOs;

namespace AiSpotTrading.Backend.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/market")]
    public class MarketController : ControllerBase
    {
        private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };
        private static readonly string[] _hosts =
        {
            "api.binance.com",
            "api1.binance.com",
            "api2.binance.com",
            "api3.binance.com",
            "api4.binance.com",
        };

        private static readonly HashSet<string> _allowedIntervals = new()
        {
            "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"
        };

        private readonly ILogger<MarketController> _logger;

        public MarketController(ILogger<MarketController> logger) => _logger = logger;

        // GET /api/market/klines?symbol=BTCFDUSD&interval=15m&limit=96
        [HttpGet("klines")]
        public async Task<IActionResult> Klines(
            [FromQuery] string symbol = "BTCFDUSD",
            [FromQuery] string interval = "15m",
            [FromQuery] int limit = 96)
        {
            symbol = symbol.ToUpperInvariant();
            if (!_allowedIntervals.Contains(interval)) return BadRequest(new { error = "invalid interval" });
            if (limit <= 0 || limit > 1000) limit = 96;

            foreach (var host in _hosts)
            {
                var url = $"https://{host}/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}";
                try
                {
                    using var resp = await _http.GetAsync(url);
                    if (!resp.IsSuccessStatusCode) continue;
                    var raw = await resp.Content.ReadAsStringAsync();

                    // Binance returns array of arrays:
                    // [ openTime, open, high, low, close, volume, closeTime, ... ]
                    using var doc = JsonDocument.Parse(raw);
                    var klines = new List<KlineDto>(doc.RootElement.GetArrayLength());
                    foreach (var k in doc.RootElement.EnumerateArray())
                    {
                        klines.Add(new KlineDto
                        {
                            Time = k[0].GetInt64() / 1000,
                            Open = decimal.Parse(k[1].GetString()!, System.Globalization.CultureInfo.InvariantCulture),
                            High = decimal.Parse(k[2].GetString()!, System.Globalization.CultureInfo.InvariantCulture),
                            Low = decimal.Parse(k[3].GetString()!, System.Globalization.CultureInfo.InvariantCulture),
                            Close = decimal.Parse(k[4].GetString()!, System.Globalization.CultureInfo.InvariantCulture),
                            Volume = decimal.Parse(k[5].GetString()!, System.Globalization.CultureInfo.InvariantCulture),
                        });
                    }
                    return Ok(klines);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Falha buscando klines em {Host}", host);
                }
            }

            return StatusCode(502, new { error = "Todos os hosts da Binance falharam." });
        }
    }
}
