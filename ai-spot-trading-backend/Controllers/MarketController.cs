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
            "api.bybit.com",
            "api.bytick.com",
        };

        // Bybit uses numeric minutes for intraday and letters for daily+
        private static readonly Dictionary<string, string> _intervalMap = new()
        {
            ["1m"]  = "1",
            ["3m"]  = "3",
            ["5m"]  = "5",
            ["15m"] = "15",
            ["30m"] = "30",
            ["1h"]  = "60",
            ["2h"]  = "120",
            ["4h"]  = "240",
            ["6h"]  = "360",
            ["8h"]  = "480",
            ["12h"] = "720",
            ["1d"]  = "D",
        };

        private readonly ILogger<MarketController> _logger;

        public MarketController(ILogger<MarketController> logger) => _logger = logger;

        // GET /api/market/klines?symbol=BTCUSDT&interval=15m&limit=96
        [HttpGet("klines")]
        public async Task<IActionResult> Klines(
            [FromQuery] string symbol = "BTCUSDT",
            [FromQuery] string interval = "15m",
            [FromQuery] int limit = 96)
        {
            symbol = symbol.ToUpperInvariant();
            if (!_intervalMap.TryGetValue(interval, out var bybitInterval))
                return BadRequest(new { error = "invalid interval" });
            if (limit <= 0 || limit > 1000) limit = 96;

            foreach (var host in _hosts)
            {
                var url = $"https://{host}/v5/market/kline?category=spot&symbol={symbol}&interval={bybitInterval}&limit={limit}";
                try
                {
                    using var resp = await _http.GetAsync(url);
                    if (!resp.IsSuccessStatusCode) continue;
                    var raw = await resp.Content.ReadAsStringAsync();

                    // Bybit returns: { retCode, result: { list: [[startTime, open, high, low, close, volume, turnover], ...] } }
                    // list is ordered newest-first — reverse to chronological order.
                    using var doc = JsonDocument.Parse(raw);
                    if (doc.RootElement.GetProperty("retCode").GetInt32() != 0) continue;

                    var list = doc.RootElement
                        .GetProperty("result")
                        .GetProperty("list")
                        .EnumerateArray()
                        .Reverse()
                        .ToList();

                    var klines = new List<KlineDto>(list.Count);
                    foreach (var k in list)
                    {
                        klines.Add(new KlineDto
                        {
                            Time   = long.Parse(k[0].GetString()!) / 1000,
                            Open   = decimal.Parse(k[1].GetString()!, System.Globalization.CultureInfo.InvariantCulture),
                            High   = decimal.Parse(k[2].GetString()!, System.Globalization.CultureInfo.InvariantCulture),
                            Low    = decimal.Parse(k[3].GetString()!, System.Globalization.CultureInfo.InvariantCulture),
                            Close  = decimal.Parse(k[4].GetString()!, System.Globalization.CultureInfo.InvariantCulture),
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

            return StatusCode(502, new { error = "Todos os hosts do Bybit falharam." });
        }
    }
}
