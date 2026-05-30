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
        public string Action { get; set; } = string.Empty; // BUY, SELL, HOLD (efetiva)

        // Ação original recomendada pelo modelo, antes de ser filtrada pela posição
        // atual do usuário. Quando Action != OriginalAction, o sinal foi descartado
        // (ex.: SELL ignorado por estar flat → salvo como HOLD com OriginalAction=SELL).
        [MaxLength(20)]
        public string OriginalAction { get; set; } = string.Empty;

        public decimal Amount { get; set; }

        public decimal Price { get; set; }

        public DateTime Timestamp { get; set; } = DateTime.UtcNow;

        [Required]
        [MaxLength(20)]
        public string Type { get; set; } = string.Empty; // REAL, PAPER

        public decimal PnL { get; set; }
    }
}
