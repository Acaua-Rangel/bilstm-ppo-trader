using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using AiSpotTrading.Backend.Data;
using AiSpotTrading.Backend.Models;

namespace AiSpotTrading.Backend.Repositories
{
    public class ExchangeAccountRepository : IExchangeAccountRepository
    {
        private readonly AppDbContext _context;

        public ExchangeAccountRepository(AppDbContext context)
        {
            _context = context;
        }

        public async Task<ExchangeAccount?> GetAccountByBinanceUidAsync(string binanceUid)
        {
            return await _context.ExchangeAccounts.FirstOrDefaultAsync(a => a.BinanceUid == binanceUid);
        }

        public async Task<ExchangeAccount> CreateAccountAsync(ExchangeAccount account)
        {
            _context.ExchangeAccounts.Add(account);
            await _context.SaveChangesAsync();
            return account;
        }

        public async Task UpdateAccountAsync(ExchangeAccount account)
        {
            _context.ExchangeAccounts.Update(account);
            await _context.SaveChangesAsync();
        }

        public async Task<IEnumerable<ExchangeAccount>> GetActiveAccountsAsync()
        {
            return await _context.ExchangeAccounts
                .Where(a => a.IsActive && a.AllocatedBalance > 0)
                .ToListAsync();
        }
    }
}
