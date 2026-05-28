using System.ComponentModel.DataAnnotations;

namespace AiSpotTrading.Backend.Models
{
    public class ExchangeAccount
    {
        [Key]
        public int Id { get; set; }

        [Required]
        public int UserId { get; set; }

        [MaxLength(100)]
        public string BinanceUid { get; set; } = string.Empty;

        [Required]
        [MaxLength(1000)]
        public string EncryptedApiKey { get; set; } = string.Empty;

        [Required]
        [MaxLength(1000)]
        public string EncryptedApiSecret { get; set; } = string.Empty;

        public decimal AllocatedBalance { get; set; }

        public bool IsPaperTrading { get; set; } = true;

        public bool IsActive { get; set; } = true;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Resetado sempre que AllocatedBalance é alterado — define o ponto de partida
        // para o cálculo de PnL realizado / não realizado no PortfolioController.
        public DateTime BalanceUpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
