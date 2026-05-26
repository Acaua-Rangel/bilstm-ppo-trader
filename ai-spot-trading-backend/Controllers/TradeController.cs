using Microsoft.AspNetCore.Mvc;
using System.Threading.Tasks;
using AiSpotTrading.Backend.Repositories;

namespace AiSpotTrading.Backend.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class TradeController : ControllerBase
    {
        private readonly ITradeRepository _tradeRepo;

        public TradeController(ITradeRepository tradeRepo)
        {
            _tradeRepo = tradeRepo;
        }

        [HttpGet("{binanceUid}")]
        public async Task<IActionResult> GetTrades(string binanceUid)
        {
            var trades = await _tradeRepo.GetTradesByBinanceUidAsync(binanceUid);
            return Ok(trades);
        }
    }
}
