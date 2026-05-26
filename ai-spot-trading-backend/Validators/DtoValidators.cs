using FluentValidation;
using AiSpotTrading.Backend.DTOs;

namespace AiSpotTrading.Backend.Validators
{
    public class BinanceOAuthRequestDtoValidator : AbstractValidator<BinanceOAuthRequestDto>
    {
        public BinanceOAuthRequestDtoValidator()
        {
            RuleFor(x => x.Code).NotEmpty().WithMessage("O código OAuth é obrigatório.");
            RuleFor(x => x.RedirectUri).NotEmpty().WithMessage("A URI de redirecionamento é obrigatória.");
        }
    }

    public class UserConfigUpdateDtoValidator : AbstractValidator<UserConfigUpdateDto>
    {
        public UserConfigUpdateDtoValidator()
        {
            RuleFor(x => x.AllocatedBalance)
                .GreaterThanOrEqualTo(0)
                .WithMessage("O saldo alocado não pode ser negativo.");
        }
    }
}
