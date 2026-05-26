using System.Collections.Generic;
using System.Threading.Tasks;
using AiSpotTrading.Backend.Models;

namespace AiSpotTrading.Backend.Repositories
{
    public interface IUserRepository
    {
        Task<User?> GetUserByBinanceUidAsync(string binanceUid);
        Task<User> CreateUserAsync(User user);
        Task UpdateUserAsync(User user);
    }

    public interface IExchangeAccountRepository
    {
        Task<ExchangeAccount?> GetAccountByBinanceUidAsync(string binanceUid);
        Task<ExchangeAccount> CreateAccountAsync(ExchangeAccount account);
        Task UpdateAccountAsync(ExchangeAccount account);
        Task<IEnumerable<ExchangeAccount>> GetActiveAccountsAsync();
    }

    public interface ITradeRepository
    {
        Task<IEnumerable<Trade>> GetTradesByBinanceUidAsync(string binanceUid);
        Task<Trade> CreateTradeAsync(Trade trade);
    }
}
