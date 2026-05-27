using FluentValidation;
using AiSpotTrading.Backend.DTOs;

namespace AiSpotTrading.Backend.Validators
{
    public class GoogleLoginRequestDtoValidator : AbstractValidator<GoogleLoginRequestDto>
    {
        public GoogleLoginRequestDtoValidator()
        {
            RuleFor(x => x.IdToken).NotEmpty().WithMessage("idToken do Google é obrigatório.");
        }
    }

    public class CreateExchangeAccountDtoValidator : AbstractValidator<CreateExchangeAccountDto>
    {
        public CreateExchangeAccountDtoValidator()
        {
            RuleFor(x => x.ApiKey).NotEmpty().MinimumLength(20)
                .WithMessage("API Key inválida.")
                .When(x => !x.IsPaperTrading);
            RuleFor(x => x.ApiSecret).NotEmpty().MinimumLength(20)
                .WithMessage("API Secret inválido.")
                .When(x => !x.IsPaperTrading);
            RuleFor(x => x.AllocatedBalance).GreaterThanOrEqualTo(0)
                .WithMessage("O saldo alocado não pode ser negativo.");
        }
    }

    public class UpdateExchangeAccountDtoValidator : AbstractValidator<UpdateExchangeAccountDto>
    {
        public UpdateExchangeAccountDtoValidator()
        {
            RuleFor(x => x.AllocatedBalance).GreaterThanOrEqualTo(0);
        }
    }
}
