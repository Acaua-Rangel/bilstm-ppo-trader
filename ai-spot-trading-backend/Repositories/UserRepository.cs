using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using AiSpotTrading.Backend.Data;
using AiSpotTrading.Backend.Models;

namespace AiSpotTrading.Backend.Repositories
{
    public class UserRepository : IUserRepository
    {
        private readonly AppDbContext _context;

        public UserRepository(AppDbContext context)
        {
            _context = context;
        }

        public async Task<User?> GetUserByBinanceUidAsync(string binanceUid)
        {
            return await _context.Users.FirstOrDefaultAsync(u => u.BinanceUid == binanceUid);
        }

        public async Task<User> CreateUserAsync(User user)
        {
            _context.Users.Add(user);
            await _context.SaveChangesAsync();
            return user;
        }

        public async Task UpdateUserAsync(User user)
        {
            _context.Users.Update(user);
            await _context.SaveChangesAsync();
        }
    }
}
