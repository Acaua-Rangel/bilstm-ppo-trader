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

        // Bybit — geo-bloqueado nos EUA mas funciona em servidores globais
        private static readonly string[] _bybitHosts = { "api.bybit.com", "api.bytick.com" };

        // Binance global — pode ser bloqueado em alguns provedores US
        private static readonly string[] _binanceHosts = { "api.binance.com", "api1.binance.com", "api2.binance.com" };

        // Binance.US — sem geo-bloqueio, acessível de servidores americanos (Render US East)
        private const string BinanceUsHost = "api.binance.us";

        // Bybit: minutos numéricos para intraday, letras para diário+
        private static readonly Dictionary<string, string> _bybitIntervalMap = new()
        {
            ["1m"] = "1", ["3m"] = "3", ["5m"] = "5", ["15m"] = "15", ["30m"] = "30",
            ["1h"] = "60", ["2h"] = "120", ["4h"] = "240", ["6h"] = "360",
            ["8h"] = "480", ["12h"] = "720", ["1d"] = "D",
        };

        // Binance / Binance.US: usa o mesmo formato de intervalo que o cliente envia
        private static readonly HashSet<string> _binanceIntervals = new()
        {
            "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"
        };

        private readonly ILogger<MarketController> _logger;

        public MarketController(ILogger<MarketController> logger) => _logger = logger;

        [HttpGet("klines")]
        public async Task<IActionResult> Klines(
            [FromQuery] string symbol = "BTCUSDT",
            [FromQuery] string interval = "15m",
            [FromQuery] int limit = 96)
        {
            symbol = symbol.ToUpperInvariant();
            if (!_bybitIntervalMap.TryGetValue(interval, out var bybitInterval) || !_binanceIntervals.Contains(interval))
                return BadRequest(new { error = "invalid interval" });
            if (limit <= 0 || limit > 1000) limit = 96;

            // ── 1. Tentar Bybit ──────────────────────────────────────────────────────
            // FDUSD não existe no Bybit — mapear para USDT (preço equivalente)
            var bybitSymbol = symbol.Replace("FDUSD", "USDT");
            foreach (var host in _bybitHosts)
            {
                var url = $"https://{host}/v5/market/kline?category=spot&symbol={bybitSymbol}&interval={bybitInterval}&limit={limit}";
                try
                {
                    var result = await TryBybit(url);
                    if (result != null) return Ok(result);
                }
                catch (Exception ex) { _logger.LogWarning(ex, "[Bybit] Falha em {Host}", host); }
            }

            // ── 2. Tentar Binance global ─────────────────────────────────────────────
            foreach (var host in _binanceHosts)
            {
                var url = $"https://{host}/api/v3/klines?symbol={symbol}&interval={interval}&limit={limit}";
                try
                {
                    var result = await TryBinance(url);
                    if (result != null) return Ok(result);
                }
                catch (Exception ex) { _logger.LogWarning(ex, "[Binance] Falha em {Host}", host); }
            }

            // ── 3. Tentar Binance.US (acessível de IPs americanos) ───────────────────
            // Binance.US usa USD em vez de USDT/FDUSD como quote asset
            var binanceUsSymbol = symbol.Replace("FDUSD", "USD").Replace("USDT", "USD");
            var binanceUsUrl = $"https://{BinanceUsHost}/api/v3/klines?symbol={binanceUsSymbol}&interval={interval}&limit={limit}";
            try
            {
                var result = await TryBinance(binanceUsUrl);
                if (result != null) return Ok(result);
            }
            catch (Exception ex) { _logger.LogWarning(ex, "[Binance.US] Falha ao buscar klines"); }

            _logger.LogError("Todas as fontes de klines falharam para {Symbol} {Interval}", symbol, interval);
            return StatusCode(502, new { error = "Serviço de dados de mercado indisponível. Tente novamente em instantes." });
        }

        // Bybit format: { retCode, result: { list: [[ts, o, h, l, c, vol, turnover], ...] } } — newest first
        private async Task<List<KlineDto>?> TryBybit(string url)
        {
            using var resp = await _http.GetAsync(url);
            if (!resp.IsSuccessStatusCode) return null;
            var raw = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.GetProperty("retCode").GetInt32() != 0) return null;

            var list = doc.RootElement.GetProperty("result").GetProperty("list")
                .EnumerateArray().Reverse().ToList();

            return list.Select(k => new KlineDto
            {
                Time   = long.Parse(k[0].GetString()!) / 1000,
                Open   = Decimal(k[1]),
                High   = Decimal(k[2]),
                Low    = Decimal(k[3]),
                Close  = Decimal(k[4]),
                Volume = Decimal(k[5]),
            }).ToList();
        }

        // Binance format: [[openTime, o, h, l, c, vol, closeTime, ...], ...] — oldest first
        private async Task<List<KlineDto>?> TryBinance(string url)
        {
            using var resp = await _http.GetAsync(url);
            if (!resp.IsSuccessStatusCode) return null;
            var raw = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return null;

            return doc.RootElement.EnumerateArray().Select(k => new KlineDto
            {
                Time   = k[0].GetInt64() / 1000,
                Open   = Decimal(k[1]),
                High   = Decimal(k[2]),
                Low    = Decimal(k[3]),
                Close  = Decimal(k[4]),
                Volume = Decimal(k[5]),
            }).ToList();
        }

        private static decimal Decimal(JsonElement e) =>
            decimal.Parse(e.ValueKind == JsonValueKind.String ? e.GetString()! : e.GetRawText(),
                System.Globalization.CultureInfo.InvariantCulture);
    }
}
