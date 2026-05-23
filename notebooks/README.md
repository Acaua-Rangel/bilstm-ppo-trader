# Notebooks

Three notebooks form the training pipeline. The dataset construction is decoupled from training so the heavy work (candle download + feature engineering) is done **once** and reused across every training run on either platform.

| Notebook | Where it runs | Purpose |
|---|---|---|
| `ai-spot-trading - Dataset.ipynb` | Kaggle (no GPU needed) | Downloads candles, builds features, splits, saves `dataset.npz`. Published as a Kaggle Dataset. |
| `ai-spot-trading - Kaggle.ipynb` | Kaggle (2× T4 GPU) | Trains BiLSTM + PPO. Loads the dataset from `/kaggle/input/`. Uses `MirroredStrategy`. |
| `ai-spot-trading - Colab.ipynb` | Colab (A100 / T4) | Same training pipeline. Loads the dataset via `kagglehub`. Uses default strategy (single GPU). |

The three notebooks share the same model definitions, reward shaping, and loss function. They differ only in where they get the data and how they distribute compute.

---

## Architecture

```
                ┌─────────────────────────────────┐
                │ ai-spot-trading - Dataset       │
                │  (run once / on data refresh)   │
                │                                 │
                │  ccxt → features → split → npz  │
                └────────────────┬────────────────┘
                                 │
                  publishes to ──┴── Kaggle Dataset
                                     acaurangel/ai-spot-trading-dataset
                                          │
                  ┌───────────────────────┴────────────────────────┐
                  │                                                │
       ┌──────────▼──────────┐                          ┌──────────▼──────────┐
       │ ai-spot-trading -    │                         │ ai-spot-trading -    │
       │ Kaggle.ipynb         │                         │ Colab.ipynb          │
       │ (2× T4, NCCL)        │                         │ (1× A100/T4)         │
       │                      │                         │                      │
       │ /kaggle/input/...    │                         │ kagglehub.download() │
       │ → BiLSTM → PPO       │                         │ → BiLSTM → PPO       │
       └──────────────────────┘                         └──────────────────────┘
```

`dataset.npz` is a single compressed bundle containing:

- `X_train`, `y_train` — forecaster training set (features + soft labels).
- `X_val`, `y_val` — purged-embargoed validation set.
- `agent_X` — feature windows used by the PPO simulator.
- `agent_candles` — raw OHLCV needed by the simulator's reward / SL-TP guards.
- `agent_vol_samples` — pre-computed per-step volatility.

---

## Workflow

### 1) Build & publish the dataset (one time, or when refreshing data)

Run on Kaggle (no GPU required):

1. Open `ai-spot-trading - Dataset.ipynb` on Kaggle.
2. Run all cells. The final cell saves `/kaggle/working/dataset.npz`.
3. In the notebook's **Output** panel → **Create new dataset** → slug `acaurangel/ai-spot-trading-dataset`.
4. To refresh: re-run, then publish a **new version** of the same dataset (the training notebooks will pick the latest version automatically).

### 2) Train on Kaggle (2 GPUs, multi-replica)

1. Open `ai-spot-trading - Kaggle.ipynb`.
2. **Settings → Accelerator → GPU T4 x2**.
3. **+ Add Data** → search `acaurangel/ai-spot-trading-dataset` → add. It now appears at `/kaggle/input/ai-spot-trading-dataset/dataset.npz`.
4. Run all. The Load cell auto-detects the Kaggle path and reads the npz directly.
5. `MirroredStrategy` activates because `len(gpus) > 1`; the `dist_scope()` helper enters the real distributed scope. PPO trains across both GPUs via NCCL all-reduce.

### 3) Train on Colab (1 GPU)

One-time setup:

1. On [kaggle.com](https://www.kaggle.com/) → account settings → **Create New API Token** → downloads `kaggle.json`.
2. In Colab, upload that token once: `mkdir -p ~/.kaggle && mv kaggle.json ~/.kaggle/ && chmod 600 ~/.kaggle/kaggle.json`.

Then per training run:

1. Open `ai-spot-trading - Colab.ipynb`.
2. **Runtime → Change runtime type → GPU (A100 recommended)**.
3. **Runtime → Disconnect and delete runtime**, then reconnect (clean CUDA context).
4. Run all. The Load cell detects there is no `/kaggle/input/` path and falls back to `kagglehub.dataset_download(...)`, which fetches the published dataset (cached in `~/.cache/kagglehub/` for subsequent runs).
5. On a single GPU `dist_scope()` returns `nullcontext()`, so models are built outside the default-strategy scope (avoids the `CUDA_ERROR_INVALID_HANDLE` issue with single-GPU default strategy in some TF builds).

---

## Important: keep hyperparameters in sync

The dataset and the training notebooks share data-shaping constants. If you change any of these in the training notebooks, you **must** also change them in the dataset notebook and republish, otherwise the loaded arrays will mismatch the model.

| Constant | Affects |
|---|---|
| `WINDOW_SIZE` | Shape of `X_train`, `X_val`, `agent_X` (time axis). |
| `HORIZON` | Shape of `y_train`, `y_val` (number of label horizons). |
| `NUM_FEATURES` | Shape of `X_*` (feature axis). |
| `SOFT_LABEL_SCALE`, `SOFT_LABEL_CLIP` | Values inside `y_*` (label calibration). |
| `INDICATOR_WARMUP`, `RETURN_CLIP`, `VOLATILITY_WINDOW` | Feature values inside `X_*` and `agent_vol_samples`. |
| `BACKTEST_HOLDOUT`, `VALIDATION_FRACTION`, `EMBARGO_FRACTION` | How the dataset is split into train/val/agent. |
| `HISTORICAL_CANDLES`, `FORECASTER_SYMBOLS`, `AGENT_SYMBOL`, `TIMEFRAME` | Which data goes in. |

Constants that **only** affect training (model size, optimizer, reward shaping, PPO hyperparams) can change freely without rebuilding the dataset.

---

## Validating a fresh forecaster before retraining the PPO

After every BiLSTM retrain, the training notebooks run a **Forecaster sanity check** cell (mirrors `src/application/services/ForecastSanityCheck.ts`). Before spending a session on PPO training, read the printed verdict:

- **`[OK]`** — dispersion + edge present; safe to proceed to PPO.
- **`[WARN] predStd < 0.02`** — signal magnitude below typical reward noise floor; PPO probably can't extract this. Tune anti-collapse (`COLLAPSE_WEIGHT`, `COLLAPSE_MIN_STD`) or `SOFT_LABEL_SCALE` and retrain BiLSTM first.
- **`[WARN] directionalAccuracy < 51%`** — review the run; weak/no direction. The 200-sample window is small, but if this triggers repeatedly the model isn't learning direction.
- **`[BLOCK] predStd < 1e-4`** — forecaster collapsed to a constant. PPO will be useless. Do not proceed.

---

## Troubleshooting

**`CUDA_ERROR_INVALID_HANDLE` on Colab during model build.** Disconnect and **delete** the runtime (not just Restart), then reconnect. A plain Restart can leave a corrupted CUDA context from a previous failed run.

**`max_seq_length <= 0` in CudnnRNN on Kaggle.** This happened when `forecaster.predict(x)` was called with a small batch under `MirroredStrategy` — one replica received batch=0. The inference cells already use the eager call `forecaster(x, training=False).numpy()` to avoid this. If you write new inference code, prefer the eager call over `.predict()`.

**`Activation: tanh has not been implemented for the Node.js backend`** at TS inference time. The tfjs-node backend does not support `tanh` in the fused `_FusedMatMul[Tanh]` path. The conversion cell runs `_unfuse_tanh(...)` on every exported model.json to split those nodes into `MatMul → BiasAdd → Tanh` (Tanh as a standalone op is supported). If you re-export models manually, run the same patch.

**Dataset version drift.** When the dataset is republished, the Kaggle path `/kaggle/input/ai-spot-trading-dataset/` always points at the latest attached version. On Colab, `kagglehub.dataset_download(...)` caches per version — delete `~/.cache/kagglehub/datasets/acaurangel/ai-spot-trading-dataset/` to force a refresh.
