namespace AiSpotTrading.Backend.DTOs
{
    public class TradeDecisionDto
    {
        public int Id { get; set; }
        public string Action { get; set; } = string.Empty; // BUY, SELL, HOLD
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
}
