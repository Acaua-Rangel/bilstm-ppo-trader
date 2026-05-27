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

            modelBuilder.Entity<User>()
                .HasIndex(u => u.GoogleSub)
                .IsUnique();

            modelBuilder.Entity<ExchangeAccount>()
                .HasIndex(a => a.UserId);

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

            modelBuilder.Entity<Trade>()
                .Property(t => t.Adx)
                .HasPrecision(8, 4);

            modelBuilder.Entity<Trade>()
                .HasIndex(t => new { t.BinanceUid, t.Timestamp });
        }
    }
}
