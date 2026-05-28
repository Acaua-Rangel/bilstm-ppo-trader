using System;
using System.ComponentModel.DataAnnotations;

namespace AiSpotTrading.Backend.Models
{
    public class Trade
    {
        [Key]
        public int Id { get; set; }

        [Required]
        [MaxLength(100)]
        public string BinanceUid { get; set; } = string.Empty;

        [Required]
        [MaxLength(50)]
        public string Symbol { get; set; } = string.Empty;

        [Required]
        [MaxLength(20)]
        public string Action { get; set; } = string.Empty; // BUY, SELL, HOLD

        public decimal Amount { get; set; }

        public decimal Price { get; set; }

        public DateTime Timestamp { get; set; } = DateTime.UtcNow;

        [Required]
        [MaxLength(20)]
        public string Type { get; set; } = string.Empty; // REAL, PAPER

        public decimal PnL { get; set; }
    }
}
