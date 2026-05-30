# AI Trading Bot

A trading bot driven by a two-stage model: a **CNN → BiLSTM → Multi-Head Attention** forecaster predicting next-bar direction, and a **PPO** reinforcement-learning agent deciding when to enter and exit. Training runs in Jupyter notebooks on Kaggle; the runtime services only load the converted models for paper/live trading.

The project is split into three services that run side by side:

| Service | Stack | Folder | Role |
|---|---|---|---|
| Backend API | C# / .NET 10, EF Core, MySQL | [ai-spot-trading-backend/](ai-spot-trading-backend/) | Auth (Google OAuth + JWT), exchange-account CRUD, trades + portfolio endpoints, klines proxy. |
| Frontend | React 19, Vite, TypeScript, Tailwind | [ai-spot-trading-frontend/](ai-spot-trading-frontend/) | Dashboard: paper/invest toggle, balance/portfolio card, trading chart with zones. |
| Trader | Python 3.12, TensorFlow, ccxt, aiomysql | [ai-spot-trading-trader/](ai-spot-trading-trader/) | Loads the trained models, fetches candles, emits BUY/SELL/HOLD signals every cycle, executes paper or real orders per user. |

All three share the same MySQL database (Aiven or local).

---

## Running locally

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| .NET SDK | 10.0+ | Backend (`dotnet --list-sdks`). |
| Node.js | 20+ | Frontend (`node -v`). |
| Python | 3.12 | Trader (`python --version`). |
| MySQL | 8.x | Local instance OR an Aiven/managed service. |

You also need:
- A **Google OAuth client ID** (Web application) for the login flow — used by both the backend and the frontend.
- A **base64-encoded 32-byte AES-256 key** shared between the backend and the trader (used to encrypt Binance API keys at rest). Generate one with `openssl rand -base64 32`.
- **Binance API key + secret** only if you plan to use Invest mode (real money). Paper mode does not need them.

### 1) Backend (C# API) — port 5000

```powershell
cd ai-spot-trading-backend
dotnet restore
```

Create `appsettings.Development.json` (gitignored) next to `appsettings.json`:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=<host>;Port=<port>;Database=ai_spot_trading;User=<user>;Password=<pass>;SslMode=Required;"
  },
  "Jwt": {
    "Secret": "<random-long-secret>",
    "Issuer": "AiSpotTrading",
    "Audience": "AiSpotTrading",
    "ExpiryDays": 7
  },
  "Google": { "ClientId": "<your-client-id>.apps.googleusercontent.com" },
  "Encryption": { "Key": "<base64-32-bytes>" },
  "Cors": { "Origins": [ "http://localhost:5173" ] }
}
```

Apply migrations and run:

```powershell
dotnet ef database update
dotnet run
```

API will be at `http://localhost:5000`. Swagger at `/swagger`.

### 2) Frontend (React + Vite) — port 5173

```powershell
cd ai-spot-trading-frontend
npm install
cp .env.example .env
```

Edit `.env`:
```
VITE_GOOGLE_CLIENT_ID=<same-client-id-as-backend>.apps.googleusercontent.com
VITE_API_BASE_URL=http://localhost:5000
```

Run:
```powershell
npm run dev
```

Open `http://localhost:5173`.

### 3) Trader (Python) — background process

```powershell
cd ai-spot-trading-trader
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Place the trained models under `models/` (see `notebooks/` for how to train them):
```
models/forecaster.keras
models/policy.keras
```

Create `.env` in the trader folder:
```
MYSQL_HOST=<same-host-as-backend>
MYSQL_PORT=<port>
MYSQL_USER=<user>
MYSQL_PASSWORD=<pass>
MYSQL_DB=ai_spot_trading
MYSQL_SSL_CA=<path-to-ca.pem>      # only if your DB requires SSL (Aiven does)
ENCRYPTION_KEY=<same-base64-key-as-backend>
```

Run:
```powershell
python main.py
```

The trader connects to the same MySQL, loops every cycle, and writes trade decisions to the `Trades` table — the dashboard reads from there.

### Order of startup

1. MySQL running and reachable.
2. Backend (`dotnet run`) — applies migrations on the schema.
3. Trader (`python main.py`) — needs the schema to exist.
4. Frontend (`npm run dev`).

---

## Project structure

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
│   ├── services/              FeatureBuilder, TradingCycle, ForecastSanityCheck
│   └── use-cases/             TradingSessionUseCase
│
├── infrastructure/            ADAPTERS (implement ports)
│   ├── market-data/           BinanceMarketData, HistoricalReplayMarketData
│   ├── execution/             PaperExecutor, BinanceLiveExecutor
│   ├── models/                BiLSTMForecaster, PPODecisionAgent
│   ├── risk/                  ConservativeRiskPolicy
│   ├── observers/             LiveLogObserver, BacktestObserver
│   ├── logging/               ConsoleLogger
│   └── storage/               FileModelStorage, RuntimeStateStore
│
├── cli/                       CLI interface
│   ├── Container.ts           Composition Root (DI)
│   ├── Cli.ts                 Dispatcher
│   └── commands/              TestCommand, InvestCommand
│
└── main.ts                    Entry point

notebooks/                     Training pipeline (Kaggle)
├── ai-spot-trading - Dataset.ipynb   Builds and publishes the dataset
├── ai-spot-trading - Kaggle.ipynb    Training on Kaggle (2× T4, MirroredStrategy)
└── README.md                          Notebook-specific instructions
```

---

## Model architecture

The forecaster was built in two phases. Each phase was motivated by a specific weakness of the previous one.

### Phase 1 — BiLSTM baseline

The starting point is a stacked **Bidirectional LSTM**. **LSTM** (Hochreiter & Schmidhuber, 1997, *Long Short-Term Memory*) is the canonical architecture for capturing long-range temporal dependencies in sequential data. The **bidirectional** variant (Schuster & Paliwal, 1997, *Bidirectional Recurrent Neural Networks*) lets each timestep be encoded with context from both past and future bars *within the input window* — useful during training because the loss landscape is smoother when the backward LSTM also informs the representation, even though only the forward pass is available at live-inference time.

```
Input  (batch, 128, 16)
 → BiLSTM(128, return_sequences)         (batch, 128, 256)
 → Dropout
 → BiLSTM(64, return_sequences)          (batch, 128, 128)
 → Dropout
 → GlobalAveragePooling1D
 → Dense + LeakyReLU
 → Dense (horizon=4, sigmoid)
```

The baseline tops out around random for next-bar direction: recurrence is good at long-range temporal structure but blind to the short, local candle patterns (3–7 bars) that often carry the actual edge.

### Phase 2 — adding CNN multi-scale + Multi-Head Attention

Two layers were added to address two specific weaknesses of the baseline:

**Conv1D multi-scale (kernels 3, 5, 7).** Short, local candle patterns (doji, engulfing, hammer) span 3–7 bars and are exactly what an LSTM is poor at extracting from raw features. Three parallel `Conv1D` branches with different kernel sizes learn pattern detectors at multiple temporal scales, then concatenate. The hybrid CNN + recurrent pattern is the standard recipe from time-series work — see Bai, Kolter & Koltun, 2018, *An Empirical Evaluation of Generic Convolutional and Recurrent Networks for Sequence Modeling*, and Fawaz et al., 2019, *Deep Learning for Time Series Classification: a review*. A `MaxPool1D(2)` halves the temporal axis, giving the downstream BiLSTM a cheaper input without losing relevant content.

**Multi-Head Self-Attention.** Even after the BiLSTM produces a rich per-timestep representation, the classification head still has to weight which timesteps in the window matter most for *this* prediction. **MHA** (Vaswani et al., 2017, *Attention Is All You Need*) performs this weighting with several heads in parallel — different heads can specialize in different temporal patterns (trend, mean-reversion, breakout, consolidation). For multi-horizon time-series forecasting specifically, this matches the design pattern in *Temporal Fusion Transformers* (Lim et al., 2021).

The final stack:

```
Input  (batch, 128, 16)
 ├─ Conv1D(32, k=3) ─┐
 ├─ Conv1D(32, k=5) ─┼─→ Concat → MaxPool(2) → Dropout    (batch, 64, 96)
 └─ Conv1D(32, k=7) ─┘
 → BiLSTM(128, return_sequences)                          (batch, 64, 256)
 → Dropout
 → BiLSTM(64, return_sequences)                           (batch, 64, 128)
 → Dropout
 → MultiHeadAttention(heads=4) + Residual + LayerNorm     (batch, 64, 128)
 → GlobalAveragePooling1D                                 (batch, 128)
 → Dense + LeakyReLU
 → Dense (horizon=4, sigmoid)                             (batch, 4)
```

Output is `P(up)` for each of the next 4 bars. Inference uses horizon 0 as the directional signal feeding the PPO state.

### PPO decision agent

The trading decision is a Proximal Policy Optimization actor-critic (Schulman et al., 2017, *Proximal Policy Optimization Algorithms*):

- **Actor:** 13-feature state → Dense(128, tanh) → Dense(64, tanh) → Dense(3, softmax) over `{HOLD, BUY, SELL}`.
- **Critic:** same input → Dense(128, tanh) → Dense(64, tanh) → Dense(1) value estimate.

The 13 state features mirror what the runtime can compute live: flat-flag, unrealized PnL, normalized bars-in-position, OHLC ratios, range/close, position indicator, recent volatility (20-bar std of returns), and the 4 forecaster probabilities. PPO is trained with a vectorized GPU simulator running 512 parallel episodes over the historical period.

### Loss & metrics

Naïve classification setups failed in subtle ways here. The current pipeline uses:

**Soft labels with drift removal.** Targets are `sigmoid(excess_return × SOFT_LABEL_SCALE)`, clipped to `[0.02, 0.98]`. The *excess* return is the future return minus the per-series drift, which **centers the labels around 0.5** instead of around the overall up-rate of the training period. Without this de-meaning, the BCE-optimal solution is just to predict the constant up-rate (≈0.8 for a multi-month bull window) — the model collapses without learning anything.

**Collapse-aware BCE.** Even with centered labels, plain BCE is trivially minimized by predicting the constant 0.5. To force the model off that degenerate attractor, the loss adds a hinge penalty on low batch-wise prediction std:

```
loss = BCE(y_true, y_pred) + max(0, COLLAPSE_MIN_STD − std(y_pred)) × COLLAPSE_WEIGHT
```

The penalty is zero once `std(y_pred) ≥ COLLAPSE_MIN_STD` and grows linearly below it. The model now has explicit pressure to *use* its inputs.

**Direction-aware metrics.** Keras' built-in `"accuracy"` and `AUC` expect binary `y_true`; with soft floats they degenerate (AUC printed `0.0` every epoch — a real bug). They are replaced with two custom metrics:

- **`DirectionalAccuracy`** — `mean((y_pred[:,0] > 0.5) == (y_true[:,0] > 0.5))` on horizon 0; the actual "% of bars where the predicted direction was right".
- **`BinaryAUCFromSoft`** — standard AUC but with `y_true` binarized at 0.5 on horizon 0 before scoring.

Training is monitored on **`val_dir_acc` (mode='max')** instead of `val_loss`: the loss floor with near-0.5 soft labels is `≈ 0.69` regardless of skill (entropy of the labels), so `val_loss` plateaus quickly and triggers EarlyStopping before the model finds a real direction. `val_dir_acc` doesn't have that floor.

---

## Guard rails

Several layers prevent the bot from doing the wrong thing — both during training (so the agent doesn't learn bad habits) and during live trading (so a bad policy can't bleed all capital).

### Training-time

- **Fee curriculum.** The PPO trains under a fee that ramps from 0 to the production fee over 20 updates so the agent doesn't immediately suffocate under realistic costs. The best-checkpoint and early-stopping tracking is **suspended during the warmup** and reset at the first post-warmup update — otherwise update 1 (fee=0) is always "best", every subsequent update looks worse, and early-stop fires before real training begins.
- **PPO early stopping with relative `min_delta`.** Improvement is counted only if `avg_reward` beats the best by more than `0.25%` (relative). Without this, tiny noise improvements keep resetting the patience counter and training runs the full 12-hour Kaggle session for nothing.
- **Anti-collapse loss term** on the forecaster (see above).
- **`val_dir_acc` early stopping** with `min_delta=0.001` and `mode='max'`. Training stops only when directional accuracy stops improving.
- **Forecaster sanity-check cell** at the end of each training run. Reports `predMean`, `predStd`, `actualUpRate`, and `directionalAccuracy` over the most recent 200 candles, and tags the result `[OK] / [WARN] / [BLOCK]`. **Always read this before retraining the PPO** — a collapsed forecaster wastes a PPO session.

### Runtime (TEST / INVEST)

- **Hard SL/TP exits.** `TradingCycle.applyExitGuards` overrides the agent's action with a forced `SELL` whenever realized PnL crosses `−STOP_LOSS_PCT` or `+TAKE_PROFIT_PCT`. The PPO can recommend `HOLD` on a deep loser, but cannot prevent the stop from firing. Mirrors the training-environment guards exactly.
- **Risk-based position sizing.** `ConservativeRiskPolicy.positionSizeFor` caps deployed cash so that hitting the stop-loss cannot lose more than `MAX_POSITION_RISK_PCT` of equity.
- **Daily drawdown circuit breaker.** `shouldHaltTrading` compares current equity to a UTC-daily baseline. If the drop exceeds `MAX_DAILY_DRAWDOWN_PCT`, the session halts and the clock is cancelled. The baseline rolls over at 00:00 UTC so a long-running deployment can't silently turn the daily limit into a session-total limit.
- **Pre-session `ForecastSanityCheck`.** Before each TEST/INVEST run, the same 200-bar diagnostic runs against the loaded model and logs a `[WARNING]` if the forecaster has collapsed.
- **`assertExecutorMode`.** TEST refuses to run with a live executor; INVEST refuses to run with a paper one. A misconfigured run can't silently use the wrong wallet.
- **Graceful shutdown.** `SIGINT` and `SIGTERM` cancel the trading clock and exit the loop cleanly.
- **Exchange-unavailable kill switch.** If `BinanceLiveExecutor` raises `ExchangeUnavailableError`, the loop halts immediately instead of retrying with capital exposed against a broken API.

---

## How to use

Training is **decoupled** from the runtime. The TypeScript runtime never trains — it just loads the converted models.

### 1) Train the models (notebooks)

Read [notebooks/README.md](notebooks/README.md) for the full instructions. In short:

| Step | Where | Frequency |
|---|---|---|
| Build & publish dataset | `ai-spot-trading - Dataset.ipynb` on Kaggle. Output `dataset.npz` is published as the Kaggle Dataset `acaurangel/ai-spot-trading-dataset`. | Once (or whenever you want fresh candles). |
| Train | `ai-spot-trading - Kaggle.ipynb` on 2× T4. Loads `dataset.npz` automatically. | Per experiment. |
| Download `python_models.zip` | Kaggle output panel. Extract into `models/` of this repo. | After each training run. |

Why decoupled:
- The dataset is downloaded + feature-engineered **once** and reused across every training run.
- The runtime stays tiny — no TensorFlow training stack to install locally.

### 2) Backtest locally (TEST)

```bash
npm install
cp .env.example .env       # edit symbol, risk params
npm run test:strategy
```

Downloads recent Binance candles, replays them through the loaded models with no money spent, and prints a full report:

| Metric | Meaning |
|---|---|
| Directional accuracy | % of horizon-0 forecasts that matched the actual next-bar direction. |
| Win rate | % of closed trades that were profitable (after fee + slippage). |
| Avg win / Avg loss | Realized PnL magnitudes — together they give the R:R ratio. |
| Expectancy / trade | Expected PnL per trade across the session. |
| Profit factor | `sum(wins) / sum(losses)`; `>1` means net positive. |
| Max drawdown | Worst peak-to-trough on the equity curve. |
| Win / Loss streaks | Distribution + max — validates the streak-sizing assumption. |

The verdict at the end is one of `[OK] / [MARGINAL] / [BLEED]` for the economic side, plus `[OK] / [BELOW] / [ABOVE]` for the win-rate target band (52–75%). **`[BLEED]` means the strategy loses money in expectation — do not move to live trading.**

### 3) Live trading (INVEST)

```bash
# .env needs BINANCE_API_KEY, BINANCE_API_SECRET
# Use BINANCE_TESTNET=true for paper-on-real-API trading first.
npm run invest
```

Loads the trained models, instantiates `BinanceLiveExecutor`, and runs the loop until `SIGINT`/`SIGTERM` or the drawdown circuit breaker fires. All runtime guard rails (above) are active.

### CPU vs GPU at runtime

Backtest and live inference can run on either CPU or CUDA GPU via `@tensorflow/tfjs-node` / `@tensorflow/tfjs-node-gpu`. Backend is chosen by:

1. CLI flag: `--device=auto|cpu|gpu`
2. Env var: `TF_DEVICE=auto|cpu|gpu`
3. Default: `auto` (tries GPU, falls back to CPU)

```bash
npm run train:cpu         # force CPU
npm run train:gpu         # force GPU (warns + falls back if CUDA missing)
npm run test:strategy:gpu
```

GPU support requires NVIDIA CUDA Toolkit **11.8** and cuDNN **8.6** (the versions `tfjs-node-gpu` 4.x is built against). On Windows, the repo ships a PowerShell setup script:

```powershell
npm run setup:cuda
# Manually download cuDNN 8.6 ZIP from NVIDIA, then:
powershell -ExecutionPolicy Bypass -File scripts/setup-cuda.ps1 -CudnnZip "C:\path\to\cudnn-windows-x86_64-8.6.0.163_cuda11-archive.zip"
npm install @tensorflow/tfjs-node-gpu
npm run train:cuda118
```

Multiple CUDA versions coexist in separate `v11.x` / `v12.x` folders — the wrapper [scripts/run-with-cuda118.ps1](scripts/run-with-cuda118.ps1) prefixes the CUDA 11.8 paths to any command without touching your system PATH.

### Environment variables

| Variable | Description | Example |
|---|---|---|
| `TRADING_SYMBOL` | Trading pair | `BTC/FDUSD` |
| `TRADING_TIMEFRAME` | Candle interval | `15m` |
| `INITIAL_CAPITAL_USD` | Starting capital (paper) | `1000` |
| `MAX_POSITION_RISK_PCT` | Fraction of cash at risk per trade | `0.1` |
| `STOP_LOSS_PCT` | Stop-loss threshold | `0.003` |
| `TAKE_PROFIT_PCT` | Take-profit threshold | `0.005` |
| `MAX_DAILY_DRAWDOWN_PCT` | Circuit breaker (resets 00:00 UTC) | `0.05` |
| `SLIPPAGE_PCT` | Market-order slippage per side (paper + reward) | `0.0005` |
| `BINANCE_API_KEY` | Binance API key (invest mode) | — |
| `BINANCE_API_SECRET` | Binance API secret (invest mode) | — |
| `BINANCE_TESTNET` | Use Binance testnet | `true` |
| `TF_DEVICE` | TF backend: `auto`, `cpu`, or `gpu` (CLI flag wins) | `auto` |

### Recommended progression

1. **Train** in a notebook → download `python_models.zip` → extract into `models/`.
2. **Backtest** locally (`npm run test:strategy`). Iterate on the model until the verdict is `[OK]` and Profit Factor is comfortably `> 1`.
3. **Paper-trade against the testnet** (`BINANCE_TESTNET=true`) for at least a couple of weeks to see how live latency / slippage / partial fills affect the realized PnL versus the backtest.
4. **Small real positions** ($50–$100) once the testnet results are consistent.
5. Scale only if metrics remain stable.

---

## Design principles

### SOLID

- **Single Responsibility:** each class does one thing. `FeatureBuilder` builds features. `RiskPolicy` evaluates risk. `TradingCycle` orchestrates one tick.
- **Open/Closed:** new modes = new entry in `Map<string, Command>`. `Cli.ts` itself doesn't change.
- **Liskov:** `PaperExecutor`, `BinanceLiveExecutor`, future executors — interchangeable through `TradeExecutor`.
- **Interface Segregation:** small, focused ports. `MarketDataProvider` only reads, never executes.
- **Dependency Inversion:** `application/` depends on `domain/ports/`, never on TF.js or ccxt.

### Object Calisthenics

- **#3 Wrap primitives:** `Money`, `Price`, `Quantity`, `Percentage` — never a bare `number`.
- **#4 First-class collections:** `CandleSeries`, `FeatureMatrix`, `TradeLedger`.
- **#5 One dot per line:** *Tell don't ask* — `position.unrealizedPnL(price)`, not `position.entryPrice / current * 100`.
- **#6 No abbreviations:** `executionPrice`, not `execPx`.
- **#7 Small entities.**
- **#8 Max 2 instance variables** where the domain allows it (value objects, `Portfolio` = cash + position).
- **#9 No getters/setters:** behavior over exposure. `position.isOpen()`, not `position.quantity > 0`.

---

## Disclaimer

This code is educational. Algorithmic trading carries a real risk of total financial loss. RL models in financial markets frequently show strong backtest metrics and then fail in production due to overfitting, regime change, and unmodeled slippage. **Audit, test, validate.** Do not use money you cannot afford to lose.
