namespace AiSpotTrading.Backend.DTOs
{
    public class BinanceOAuthRequestDto
    {
        public string Code { get; set; } = string.Empty;
        public string RedirectUri { get; set; } = string.Empty;
    }

    public class UserConfigUpdateDto
    {
        public decimal AllocatedBalance { get; set; }
        public bool IsPaperTrading { get; set; }
        public bool IsActive { get; set; }
    }
}
