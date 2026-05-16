# AI Trading Bot

Bot de trading com **PatchTST** (forecast) + **PPO** (decisão), em TypeScript.

## Arquitetura

**Hexagonal Architecture (Ports & Adapters) + Clean Architecture**

```
src/
├── domain/                    Núcleo - regras de negócio puras
│   ├── value-objects/         Money, Price, Quantity, Symbol, Percentage…
│   ├── entities/              Candle, Order, Position, Portfolio
│   ├── collections/           CandleSeries, FeatureMatrix (first-class)
│   ├── enums/                 TradingAction (com comportamento)
│   ├── ports/                 INTERFACES — pontos de extensão
│   └── errors/                DomainError hierarchy
│
├── application/               Casos de uso (orquestração)
│   ├── services/              FeatureBuilder, TradingCycle
│   └── use-cases/             TrainModels, TestStrategy, Invest
│
├── infrastructure/            ADAPTADORES (implementam ports)
│   ├── market-data/           BinanceMarketData
│   ├── execution/             PaperExecutor, BinanceLiveExecutor
│   ├── models/                PatchTSTForecaster, PPODecisionAgent
│   ├── risk/                  ConservativeRiskPolicy
│   ├── logging/               ConsoleLogger
│   └── storage/               FileModelStorage
│
├── cli/                       Interface CLI
│   ├── Container.ts           Composition Root (DI)
│   ├── Cli.ts                 Dispatcher
│   └── commands/              TrainCommand, TestCommand, InvestCommand
│
└── main.ts                    Entry point
```

## Princípios aplicados

### SOLID
- **Single Responsibility:** cada classe faz uma coisa. `FeatureBuilder` só constrói features. `RiskPolicy` só avalia risco.
- **Open/Closed:** novos modos CLI = nova entrada no `Map<string, Command>`. Sem editar `Cli.ts`.
- **Liskov:** `PaperExecutor`, `BinanceLiveExecutor` e futuros executors são intercambiáveis via `TradeExecutor`.
- **Interface Segregation:** ports pequenos e focados. `MarketDataProvider` só lê dados, não executa.
- **Dependency Inversion:** `application/` depende de ports (`domain/ports/`), nunca de TF.js ou ccxt.

### Object Calisthenics
- **#3 Wrap primitives:** `Money`, `Price`, `Quantity`, `Percentage` — nunca `number` solto.
- **#4 First-class collections:** `CandleSeries`, `FeatureMatrix`.
- **#5 One dot per line:** Tell don't ask — `position.unrealizedPnL(price)`, não `position.entryPrice / current * 100`.
- **#6 No abbreviations:** `executionPrice` em vez de `execPx`.
- **#7 Small entities:** classes pequenas, métodos curtos.
- **#8 Max 2 instance variables:** aplicado nos VOs e em `Portfolio` (cash + position).
- **#9 No getters/setters:** comportamento ao invés de exposição. `position.isOpen()`, não `position.quantity > 0`.

## Os 3 modos

### 1. TRAIN — treina os modelos

```bash
npm run train
```

Baixa 2000 candles históricos, treina PatchTST com regressão supervisionada, depois treina o PPO em N episódios. **Nunca toca em executor real** — `TrainCommand` nem instancia executor.

### 2. TEST — paper trading

```bash
npm run test:strategy
```

Carrega os modelos salvos, roda inferência ao vivo, mas o executor é `PaperExecutor`. Vê o que o bot **decidiria fazer**, simula saldos, mas zero dinheiro real envolvido. Útil para validar a estratégia em mercado live antes de plugar a carteira.

### 3. INVEST — dinheiro real 24/7

```bash
npm run invest
```

Carrega os modelos, instancia `BinanceLiveExecutor` (testnet ou produção via env), e roda o loop até receber SIGINT/SIGTERM ou disparar o circuit breaker de drawdown.

**Proteções obrigatórias:**
- `assertLiveExecutor()` — falha rápido se algum erro de fiação fizer cair em paper.
- Circuit breaker — para tudo se drawdown > limite.
- Position sizing — nunca arrisca mais que `MAX_POSITION_RISK_PCT` por trade.
- Graceful shutdown — `SIGINT`/`SIGTERM` fecham o loop limpo.

## Setup

```bash
cp .env.example .env
# Edite .env com suas credenciais Binance
npm install
npm run train
npm run test:strategy  # valide antes!
npm run invest         # só depois de muita validação
```

## Ordem recomendada de execução

1. **train** → gera `./models/patchtst` e `./models/ppo`
2. **test** → rode por dias. Avalie acurácia, P&L simulado.
3. **invest com TESTNET** (`BINANCE_TESTNET=true`) → semanas de validação.
4. **invest com valores pequenos** ($50–100) em produção real.
5. Escale gradualmente apenas se métricas se mantiverem.

## ⚠️ Disclaimer

Este código é educacional. Trading algorítmico tem risco real de perda financeira total. Modelos de RL em mercados financeiros frequentemente apresentam ótimas métricas em backtest e fracassam em produção (overfitting, regime change, slippage não modelado). Audite, teste, valide. Não use dinheiro que você não pode perder.
