# AI Trading Bot

Trading bot with **BiLSTM + Self-Attention** (forecast) + **PPO** (decision), built in TypeScript.

Forecaster is pre-trained from scratch on a 4-asset multi-symbol dataset (BTC + ETH + SOL + BNB) for ~200k labeled samples; the PPO agent specializes on the primary symbol (BTC by default).

## Architecture

**Hexagonal Architecture (Ports & Adapters) + Clean Architecture**

```
src/
├── domain/                    Core — pure business rules
│   ├── value-objects/         Money, Price, Quantity, Symbol, Percentage…
│   ├── entities/              Candle, Order, Position, Portfolio
│   ├── collections/           CandleSeries, FeatureMatrix (first-class)
│   ├── enums/                 TradingAction (with behavior)
│   ├── ports/                 INTERFACES — extension points
│   └── errors/                DomainError hierarchy
│
├── application/               Use cases (orchestration)
│   ├── services/              FeatureBuilder, TradingCycle
│   └── use-cases/             TrainModels, Backtest, Invest
│
├── infrastructure/            ADAPTERS (implement ports)
│   ├── market-data/           BinanceMarketData
│   ├── execution/             PaperExecutor, BinanceLiveExecutor
│   ├── models/                BiLSTMForecaster, PPODecisionAgent
│   ├── risk/                  ConservativeRiskPolicy
│   ├── logging/               ConsoleLogger
│   └── storage/               FileModelStorage
│
├── cli/                       CLI interface
│   ├── Container.ts           Composition Root (DI)
│   ├── Cli.ts                 Dispatcher
│   └── commands/              TrainCommand, TestCommand, InvestCommand
│
└── main.ts                    Entry point
```

## Design principles

### SOLID
- **Single Responsibility:** each class does one thing. `FeatureBuilder` only builds features. `RiskPolicy` only evaluates risk.
- **Open/Closed:** new CLI modes = new entry in `Map<string, Command>`. No changes to `Cli.ts`.
- **Liskov:** `PaperExecutor`, `BinanceLiveExecutor`, and future executors are interchangeable via `TradeExecutor`.
- **Interface Segregation:** small, focused ports. `MarketDataProvider` only reads data, never executes.
- **Dependency Inversion:** `application/` depends on ports (`domain/ports/`), never on TF.js or ccxt.

### Object Calisthenics
- **#3 Wrap primitives:** `Money`, `Price`, `Quantity`, `Percentage` — never a bare `number`.
- **#4 First-class collections:** `CandleSeries`, `FeatureMatrix`.
- **#5 One dot per line:** Tell don't ask — `position.unrealizedPnL(price)`, not `position.entryPrice / current * 100`.
- **#6 No abbreviations:** `executionPrice` instead of `execPx`.
- **#7 Small entities:** small classes, short methods.
- **#8 Max 2 instance variables:** applied in value objects and `Portfolio` (cash + position).
- **#9 No getters/setters:** behavior over exposure. `position.isOpen()`, not `position.quantity > 0`.

## The 3 modes

### 1. TRAIN — trains the models

```bash
npm run train
```

Downloads 50000 historical candles per symbol from Binance for each of the 4 forecaster symbols (BTC, ETH, SOL, BNB), trains the **BiLSTM + Self-Attention** forecaster with supervised regression (predicting the next 4 returns) on the combined dataset (~200k samples), then trains the **PPO** agent for 50 episodes on the primary symbol only. **Never touches a real executor** — `TrainCommand` does not instantiate one.

Forecaster architecture:
```
Input [B, 64, 10]
 → BiLSTM (return_sequences=True)        [B, 64, 128]
 → Dropout
 → BiLSTM (return_sequences=True)        [B, 64, 64]
 → Dropout
 → Self-Attention (dModel=64)            [B, 64, 64]
 → GlobalAveragePooling1D                [B, 64]
 → Dense + LeakyReLU                     [B, 64]
 → Dense (horizon=4)                     [B, 4]
```

Training optimizations included:
- L2 regularization on all LSTM kernels
- Cosine annealing learning rate schedule
- Early stopping on `val_loss` (patience 8)
- Exponential LR decay for PPO across episodes
- Global norm gradient clipping (`maxGradNorm = 0.5`)
- O(n²) fix: bounded sliding window with 200-candle indicator warmup
- Return clipping ±10% to remove flash crash outliers
- Dynamic RL state: unrealized PnL, time in position, recent volatility

#### Checkpoints (resume training)

Long runs can be checkpointed and resumed:

```bash
# First run — saves every 5 epochs/episodes
npm run train -- --checkpoint=./checkpoints/run-1

# Interrupted? Run the same command again — it auto-resumes from the
# last saved checkpoint (exact epoch, episode, LR, early-stopping memory).
npm run train -- --checkpoint=./checkpoints/run-1

# Custom frequency
npm run train -- --checkpoint=./checkpoints/run-1 --checkpoint-every=10
```

What's preserved across a resume:
- Forecaster: completed epochs, cosine-annealed LR, best `val_loss`, patience counter
- Agent: completed episodes, `updateCount` (drives PPO LR decay)
- Both: model weights

Known limitation: the Adam optimizer's internal momentum is **not** preserved, so the first epoch after a resume may show slight gradient noise. The LR schedule itself is exact (derived from the epoch number, not optimizer state).

Checkpoint directory layout:
```
./checkpoints/run-1/
  metadata.json         counters, schedule state, input snapshot
  forecaster/           BiLSTM weights
  agent/policy/         PPO actor weights
  agent/value/          PPO critic weights
```

### 2. TEST — backtest with real data

```bash
npm run test:strategy
```

Downloads 1000 real Binance candles, then iterates candle by candle simulating trades using the trained models — **no money spent**. Reports two key metrics:

| Metric | Description |
|---|---|
| **Directional accuracy** | % of forecaster predictions that matched the actual next-candle direction |
| **Win rate** | % of closed trades that were profitable (after 0.1% fee per side) |

The verdict at the end flags whether win rate is within the target range of **52%–75%**:
- `[OK]` — within range, model is beating random consistently
- `[BELOW]` — below 52%, consider more training or hyperparameter tuning
- `[ABOVE]` — above 75%, suspect overfitting or data leakage

### 3. INVEST — real money 24/7

```bash
npm run invest
```

Loads the trained models, instantiates `BinanceLiveExecutor` (testnet or production via env), and runs the trading loop until `SIGINT`/`SIGTERM` or the drawdown circuit breaker triggers.

**Built-in safeguards:**
- `assertLiveExecutor()` — fails fast if misconfiguration would fall back to paper.
- Circuit breaker — halts all trading if drawdown exceeds `MAX_DAILY_DRAWDOWN_PCT`.
- Position sizing — never risks more than `MAX_POSITION_RISK_PCT` per trade.
- Graceful shutdown — `SIGINT`/`SIGTERM` close the loop cleanly.

## Setup

```bash
cp .env.example .env
# Edit .env with your Binance credentials and risk parameters
npm install
npm run train
npm run test:strategy   # validate before going live!
npm run invest          # only after thorough validation
```

## CPU vs GPU (CUDA)

The bot supports both CPU and CUDA-accelerated GPU execution via TensorFlow.js. Backend selection happens at startup; once chosen, all training and inference run on it.

### How it chooses

1. CLI flag: `--device=auto|cpu|gpu`
2. Env var: `TF_DEVICE=auto|cpu|gpu`
3. Default: `auto`

`auto` tries GPU first and falls back to CPU if `@tensorflow/tfjs-node-gpu` is not installed or fails to load (missing CUDA, wrong driver, etc.). `gpu` attempts GPU and warns + falls back on failure. `cpu` forces CPU regardless.

You'll see a line at startup like:
```
[TF] Backend: GPU (mode: auto)
```

### Installing GPU support

`@tensorflow/tfjs-node-gpu` is declared as an `optionalDependency`, so `npm install` won't fail if your machine doesn't have CUDA. If the optional install was skipped, install it manually after setting up CUDA:

```bash
npm install @tensorflow/tfjs-node-gpu
```

Requirements: NVIDIA GPU with CUDA Toolkit 11.8 and cuDNN 8.6 installed (the versions tfjs-node-gpu 4.x is built against).

#### Windows — automated setup (CUDA 11.8 side-by-side)

The repo ships a PowerShell installer that downloads and installs the exact CUDA version tfjs-node-gpu wants, **without touching your NVIDIA driver** or any other CUDA toolkit you already have. Multiple CUDA versions live in separate `v11.x`/`v12.x` folders by design — they don't conflict.

```powershell
# 1. Install CUDA 11.8 toolkit (downloads ~3 GB, runtime components only)
npm run setup:cuda

# 2. Download cuDNN 8.6 manually (NVIDIA login required, can't be automated):
#    https://developer.nvidia.com/rdp/cudnn-archive
#    → "Download cuDNN v8.6.0 (October 3rd, 2022), for CUDA 11.x"
#    → "Local Installer for Windows (Zip)"
# 3. Feed the ZIP back to the script:
powershell -ExecutionPolicy Bypass -File scripts/setup-cuda.ps1 -CudnnZip "C:\Downloads\cudnn-windows-x86_64-8.6.0.163_cuda11-archive.zip"

# 4. Install the GPU TF.js bindings
npm install @tensorflow/tfjs-node-gpu

# 5. Train/backtest with CUDA 11.8 scoped to the process
#    (your system PATH stays as it was — other CUDA versions remain default
#     for whatever else uses them)
npm run train:cuda118
npm run test:strategy:cuda118
```

The wrapper [scripts/run-with-cuda118.ps1](scripts/run-with-cuda118.ps1) can prefix any command:

```powershell
.\scripts\run-with-cuda118.ps1 nvcc --version
.\scripts\run-with-cuda118.ps1 npx ts-node src/main.ts invest --device=gpu
```

### Convenience scripts

```bash
npm run train             # auto (GPU if available)
npm run train:gpu         # force GPU (falls back to CPU if missing)
npm run train:cpu         # force CPU
npm run test:strategy:gpu # backtest on GPU

# Generic form
npm run train -- --device=gpu
npm run test:strategy -- --device=cpu
```

### Environment variables

| Variable | Description | Example |
|---|---|---|
| `TRADING_SYMBOL` | Trading pair | `BTC/USDT` |
| `TRADING_TIMEFRAME` | Candle interval | `1h` |
| `INITIAL_CAPITAL_USD` | Starting capital in USD | `1000` |
| `MAX_POSITION_RISK_PCT` | Fraction of cash used per trade | `0.1` |
| `STOP_LOSS_PCT` | Stop-loss threshold | `0.02` |
| `TAKE_PROFIT_PCT` | Take-profit threshold (symmetric to SL) | `0.02` |
| `MAX_DAILY_DRAWDOWN_PCT` | Circuit breaker — resets at 00:00 UTC | `0.05` |
| `SLIPPAGE_PCT` | Market-order slippage per side (paper + reward) | `0.0005` |
| `BINANCE_API_KEY` | Binance API key (invest mode only) | — |
| `BINANCE_API_SECRET` | Binance API secret (invest mode only) | — |
| `BINANCE_TESTNET` | Use Binance testnet | `true` |
| `TF_DEVICE` | TF backend: `auto`, `cpu`, or `gpu` (CLI flag wins) | `auto` |

## Recommended execution order

1. **train** → generates `./models/bilstm` and `./models/ppo`
2. **test** → run the backtest, check that win rate is in the 52%–75% range
3. **invest with testnet** (`BINANCE_TESTNET=true`) → weeks of validation
4. **invest with small amounts** ($50–100) in real production
5. Scale gradually only if metrics remain consistent

## Disclaimer

This code is educational. Algorithmic trading carries a real risk of total financial loss. RL models in financial markets frequently show strong backtest metrics and fail in production due to overfitting, regime change, and unmodeled slippage. Audit, test, validate. Do not use money you cannot afford to lose.
