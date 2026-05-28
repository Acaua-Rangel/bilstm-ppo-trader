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

        public async Task<IEnumerable<Trade>> GetRecentByBinanceUidAsync(string binanceUid, DateTime since)
        {
            return await _context.Trades
                .Where(t => t.BinanceUid == binanceUid && t.Timestamp >= since)
                .OrderBy(t => t.Timestamp)
                .ToListAsync();
        }

        public async Task<IEnumerable<Trade>> GetRecentByBinanceUidsAsync(IEnumerable<string> binanceUids, DateTime since)
        {
            var ids = binanceUids.ToList();
            if (ids.Count == 0) return Array.Empty<Trade>();
            return await _context.Trades
                .Where(t => ids.Contains(t.BinanceUid) && t.Timestamp >= since)
                .OrderBy(t => t.Timestamp)
                .ToListAsync();
        }

        public async Task<IEnumerable<Trade>> GetByBinanceUidsAsync(IEnumerable<string> binanceUids)
        {
            var ids = binanceUids.ToList();
            if (ids.Count == 0) return Array.Empty<Trade>();
            return await _context.Trades
                .Where(t => ids.Contains(t.BinanceUid))
                .OrderBy(t => t.Timestamp)
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
