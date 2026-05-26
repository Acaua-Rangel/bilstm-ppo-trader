using AiSpotTrading.Backend.Models;

namespace AiSpotTrading.Backend.Services
{
    public interface IJwtService
    {
        string CreateToken(User user);
    }
}
