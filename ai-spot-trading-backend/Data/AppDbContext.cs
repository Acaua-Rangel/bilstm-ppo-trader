using Microsoft.EntityFrameworkCore;
using AiSpotTrading.Backend.Models;

namespace AiSpotTrading.Backend.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
        {
        }

        public DbSet<User> Users { get; set; }
        public DbSet<ExchangeAccount> ExchangeAccounts { get; set; }
        public DbSet<Trade> Trades { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            
            // Decimal precision
            modelBuilder.Entity<ExchangeAccount>()
                .Property(e => e.AllocatedBalance)
                .HasPrecision(18, 8);

            modelBuilder.Entity<Trade>()
                .Property(t => t.Amount)
                .HasPrecision(18, 8);

            modelBuilder.Entity<Trade>()
                .Property(t => t.Price)
                .HasPrecision(18, 8);

            modelBuilder.Entity<Trade>()
                .Property(t => t.PnL)
                .HasPrecision(18, 8);
        }
    }
}
