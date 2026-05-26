namespace AiSpotTrading.Backend.DTOs
{
    public class GoogleLoginRequestDto
    {
        public string IdToken { get; set; } = string.Empty;
    }

    public class MeResponseDto
    {
        public int Id { get; set; }
        public string? Email { get; set; }
        public string? Name { get; set; }
        public string? AvatarUrl { get; set; }
        public string? BinanceUid { get; set; }
        public bool HasExchangeAccount { get; set; }
    }

    public class CreateExchangeAccountDto
    {
        public string ApiKey { get; set; } = string.Empty;
        public string ApiSecret { get; set; } = string.Empty;
        public string? BinanceUid { get; set; }
        public decimal AllocatedBalance { get; set; }
        public bool IsPaperTrading { get; set; } = true;
    }

    public class UpdateExchangeAccountDto
    {
        public decimal AllocatedBalance { get; set; }
        public bool IsPaperTrading { get; set; }
        public bool IsActive { get; set; }
    }

    public class ExchangeAccountResponseDto
    {
        public int Id { get; set; }
        public string BinanceUid { get; set; } = string.Empty;
        public decimal AllocatedBalance { get; set; }
        public bool IsPaperTrading { get; set; }
        public bool IsActive { get; set; }
        public string ApiKeyMasked { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
    }
}
