namespace AiSpotTrading.Backend.DTOs
{
    public class TradeDecisionDto
    {
        public int Id { get; set; }
        public string Action { get; set; } = string.Empty; // BUY, SELL, HOLD (efetiva)
        public string OriginalAction { get; set; } = string.Empty; // o que o modelo queria
        public decimal Price { get; set; }
        public decimal Amount { get; set; }
        public decimal PnL { get; set; }
        public string Type { get; set; } = string.Empty; // PAPER, REAL
        public long Timestamp { get; set; } // unix seconds
    }

    public class KlineDto
    {
        public long Time { get; set; }   // unix seconds
        public decimal Open { get; set; }
        public decimal High { get; set; }
        public decimal Low { get; set; }
        public decimal Close { get; set; }
        public decimal Volume { get; set; }
    }

    public class PortfolioDto
    {
        public int ExchangeAccountId { get; set; }
        public string BinanceUid { get; set; } = string.Empty;
        public bool IsPaperTrading { get; set; }
        public decimal InitialBalance { get; set; }
        public decimal RealizedPnL { get; set; }
        public decimal UnrealizedPnL { get; set; }
        public decimal EstimatedTotal { get; set; }
        public decimal CurrentPrice { get; set; }
        public bool HasOpenPosition { get; set; }
        public decimal? OpenBuyPrice { get; set; }
        public decimal? OpenAmount { get; set; }
    }
}
