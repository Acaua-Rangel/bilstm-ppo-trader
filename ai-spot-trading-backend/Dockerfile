# Usa o SDK oficial do .NET para fazer o build e publicar a aplicação
# Nota: Baseado na versão do seu arquivo csproj (net10.0)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copia apenas o arquivo de projeto primeiro para aproveitar o cache de camadas do Docker
COPY ["AiSpotTrading.Backend.csproj", "./"]
RUN dotnet restore "./AiSpotTrading.Backend.csproj"

# Copia o restante dos arquivos e compila o projeto
COPY . .
RUN dotnet publish "AiSpotTrading.Backend.csproj" -c Release -o /app/publish /p:UseAppHost=false

# Inicia uma nova etapa a partir de uma imagem menor, focada apenas no ambiente de execução (Runtime)
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

ENTRYPOINT ["dotnet", "AiSpotTrading.Backend.dll"]
