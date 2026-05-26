using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using AiSpotTrading.Backend.Data;
using AiSpotTrading.Backend.Models;

namespace AiSpotTrading.Backend.Repositories
{
    public class TradeRepository : ITradeRepository
    {
        private readonly AppDbContext _context;

        public TradeRepository(AppDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Trade>> GetTradesByBinanceUidAsync(string binanceUid)
        {
            return await _context.Trades
                .Where(t => t.BinanceUid == binanceUid)
                .OrderByDescending(t => t.Timestamp)
                .ToListAsync();
        }

        public async Task<Trade> CreateTradeAsync(Trade trade)
        {
            _context.Trades.Add(trade);
            await _context.SaveChangesAsync();
            return trade;
        }
    }
}
