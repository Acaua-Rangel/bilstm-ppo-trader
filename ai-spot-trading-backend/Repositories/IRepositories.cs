using System.Collections.Generic;
using System.Threading.Tasks;
using AiSpotTrading.Backend.Models;

namespace AiSpotTrading.Backend.Repositories
{
    public interface IUserRepository
    {
        Task<User?> GetByIdAsync(int id);
        Task<User?> GetByGoogleSubAsync(string googleSub);
        Task<User?> GetUserByBinanceUidAsync(string binanceUid);
        Task<User> CreateUserAsync(User user);
        Task UpdateUserAsync(User user);
    }

    public interface IExchangeAccountRepository
    {
        Task<ExchangeAccount?> GetByIdAsync(int id);
        Task<ExchangeAccount?> GetAccountByBinanceUidAsync(string binanceUid);
        Task<IEnumerable<ExchangeAccount>> GetByUserIdAsync(int userId);
        Task<ExchangeAccount> CreateAccountAsync(ExchangeAccount account);
        Task UpdateAccountAsync(ExchangeAccount account);
        Task DeleteAsync(ExchangeAccount account);
        Task<IEnumerable<ExchangeAccount>> GetActiveAccountsAsync();
    }

    public interface ITradeRepository
    {
        Task<IEnumerable<Trade>> GetTradesByBinanceUidAsync(string binanceUid);
        Task<IEnumerable<Trade>> GetRecentByBinanceUidAsync(string binanceUid, DateTime since);
        Task<IEnumerable<Trade>> GetRecentByBinanceUidsAsync(IEnumerable<string> binanceUids, DateTime since);
        Task<IEnumerable<Trade>> GetByBinanceUidsAsync(IEnumerable<string> binanceUids);
        Task<Trade> CreateTradeAsync(Trade trade);
    }
}
