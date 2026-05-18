import { MarketDataProvider } from "../../domain/ports/MarketDataProvider";
import { ForecastModel, ForecasterTrainingState } from "../../domain/ports/ForecastModel";
import { DecisionAgent } from "../../domain/ports/DecisionAgent";
import { ModelStorage } from "../../domain/ports/ModelStorage";
import { Logger } from "../../domain/ports/Logger";
import { FeatureBuilder } from "../services/FeatureBuilder";
import { PurgedEmbargoedSplit } from "../services/PurgedEmbargoedSplit";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { CandleSeries } from "../../domain/collections/CandleSeries";
import { FeatureMatrix } from "../../domain/collections/FeatureMatrix";
import { TradingAction } from "../../domain/enums/TradingAction";
import {
  CheckpointManager, CheckpointData, AgentCheckpointState,
  TrainInputSnapshot, TrainingPhase,
} from "../../infrastructure/storage/CheckpointManager";

// Warmup buffer for indicators (MACD needs ~50 candles, BB needs 20).
const INDICATOR_WARMUP = 200;
// Return clipping: ±10% per candle removes flash crash outliers.
const RETURN_CLIP = 0.1;
// Window for computing volatility in the agent state.
const VOLATILITY_WINDOW = 20;
// Trading fee on each side (matches backtest and exchange reality).
const FEE_RATE = 0.001;
// The last N candles of the downloaded series are held out for the backtest.
// Training uses the earlier portion; backtest uses the later portion.
// Both come from the same single download, so the split is internal and
// the training window always includes the most recent data possible.
const BACKTEST_HOLDOUT_CANDLES = 1000;
// Fraction of (post-purge) samples held out for forecaster validation.
const VALIDATION_FRACTION = 0.1;
// Embargo fraction (López de Prado): drops samples adjacent to the
// validation set to neutralize serial correlation that survives the
// label horizon. 1% is a conservative default for hourly candles.
const EMBARGO_FRACTION = 0.01;

/**
 * Use Case: trains the forecast model (BiLSTM) and decision agent (PPO).
 * TRAIN mode: never touches a real executor.
 *
 * Short-term, long-only trading: the agent can only enter long (BUY) and
 * exit long (SELL). No short selling. Stop loss is enforced during training
 * to mirror the backtest and live trading environment.
 *
 * Performance: features and forecasts are precomputed once and reused across
 * all PPO episodes (the forecaster is frozen during PPO). This eliminates
 * hundreds of thousands of batch=1 GPU calls, letting the GPU actually saturate.
 */
export class TrainModelsUseCase {
  private cachedFeatures: FeatureMatrix[] | null = null;
  private cachedTargets: number[][] | null = null;
  private cachedForecasts: number[][] | null = null;
  private cachedVolatility: number[] | null = null;

  constructor(private readonly deps: TrainDependencies) {}

  async execute(input: TrainInput): Promise<void> {
    this.deps.logger.info("=== TRAINING MODE started ===");
    const resumed = await this.tryLoadCheckpoint(input);
    const series = await this.fetchHistory(input);

    this.precomputeFeaturesAndVolatility(series, input);

    const forecasterState: ForecasterTrainingState = resumed?.forecaster ?? {
      completedEpochs: 0, bestValLoss: Infinity, patienceCount: 0,
    };
    const agentState: AgentCheckpointState = resumed?.agent ?? {
      completedEpisodes: 0, updateCount: 0,
    };
    const createdAt = resumed?.createdAt ?? new Date().toISOString();

    const finalForecaster = await this.maybeTrainForecaster(
      input, forecasterState, agentState, createdAt
    );

    await this.precomputeForecasts();

    const finalAgent = await this.maybeTrainAgent(
      series, input, finalForecaster, agentState, createdAt
    );

    await this.persistArtifacts(input);
    await this.saveCheckpoint("done", input, finalForecaster, finalAgent, createdAt);
    this.deps.logger.info("Training complete");
  }

  private async tryLoadCheckpoint(input: TrainInput): Promise<CheckpointData | null> {
    const ckpt = this.deps.checkpoint;
    if (!ckpt) return null;
    if (!ckpt.exists()) {
      this.deps.logger.info(`No checkpoint found at ${ckpt.directory}, starting fresh`);
      return null;
    }
    const data = await ckpt.load();
    if (!data) return null;
    this.deps.logger.info(`Resuming from checkpoint at ${ckpt.directory}`, {
      phase: data.phase,
      forecasterEpoch: data.forecaster.completedEpochs,
      agentEpisode: data.agent.completedEpisodes,
      updateCount: data.agent.updateCount,
    });
    this.warnIfInputChanged(input, data.input);
    return data;
  }

  private warnIfInputChanged(current: TrainInput, saved: TrainInputSnapshot): void {
    const log = this.deps.logger;
    if (current.symbol.toString() !== saved.symbol) {
      log.warn(`symbol changed: ${saved.symbol} → ${current.symbol.toString()}`);
    }
    if (current.historicalCandles !== saved.historicalCandles) {
      log.warn(`historicalCandles changed: ${saved.historicalCandles} → ${current.historicalCandles}`);
    }
    if (current.windowSize !== saved.windowSize) {
      log.warn(`windowSize changed: ${saved.windowSize} → ${current.windowSize}`);
    }
    if (current.horizon !== saved.horizon) {
      log.warn(`horizon changed: ${saved.horizon} → ${current.horizon}`);
    }
    if (current.forecastEpochs !== saved.forecastEpochs) {
      log.warn(`forecastEpochs changed: ${saved.forecastEpochs} → ${current.forecastEpochs}`);
    }
    if (current.rlEpisodes !== saved.rlEpisodes) {
      log.warn(`rlEpisodes changed: ${saved.rlEpisodes} → ${current.rlEpisodes}`);
    }
  }

  private async fetchHistory(input: TrainInput): Promise<CandleSeries> {
    const total = input.historicalCandles + BACKTEST_HOLDOUT_CANDLES;
    this.deps.logger.info(
      `Downloading ${total} candles (${input.historicalCandles} train + ${BACKTEST_HOLDOUT_CANDLES} holdout)`
    );
    const full = await this.deps.marketData.fetchRecentCandles(input.symbol, total, 0);
    return full.rangeFromIndex(0, full.size() - BACKTEST_HOLDOUT_CANDLES);
  }

  /**
   * One-time CPU work: compute feature matrices, future returns, and volatility
   * for every step. These don't depend on model state and are reused across
   * forecaster training, PPO precompute, and every PPO episode.
   */
  private precomputeFeaturesAndVolatility(series: CandleSeries, input: TrainInput): void {
    if (this.cachedFeatures && this.cachedTargets && this.cachedVolatility) return;
    this.deps.logger.info("Precomputing features, targets, and volatility...");
    const t0 = Date.now();
    const features: FeatureMatrix[] = [];
    const targets: number[][] = [];
    for (let i = input.windowSize; i < series.size() - input.horizon; i++) {
      const windowStart = Math.max(0, i - input.windowSize - INDICATOR_WARMUP);
      const window = series.rangeFromIndex(windowStart, i);
      features.push(this.deps.featureBuilder.build(window));
      targets.push(this.buildFutureReturns(series, i, input.horizon));
    }
    this.cachedFeatures = features;
    this.cachedTargets = targets;
    this.cachedVolatility = this.computeVolatilitySeries(series);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    this.deps.logger.info(`Cached ${features.length} feature matrices in ${elapsed}s`);
  }

  private computeVolatilitySeries(series: CandleSeries): number[] {
    const vol = new Array(series.size()).fill(0);
    for (let i = 1; i < series.size(); i++) {
      const start = Math.max(1, i - VOLATILITY_WINDOW);
      let sum = 0;
      let count = 0;
      for (let k = start; k <= i; k++) {
        const prev = series.at(k - 1).closePrice().toNumber();
        const curr = series.at(k).closePrice().toNumber();
        sum += (curr - prev) / prev;
        count++;
      }
      const mean = sum / count;
      let varSum = 0;
      for (let k = start; k <= i; k++) {
        const prev = series.at(k - 1).closePrice().toNumber();
        const curr = series.at(k).closePrice().toNumber();
        const r = (curr - prev) / prev;
        varSum += (r - mean) ** 2;
      }
      vol[i] = Math.sqrt(varSum / count);
    }
    return vol;
  }

  /**
   * Single batched GPU call for all forecasts, after the BiLSTM is trained.
   * Replaces ~750k individual batch=1 predict() calls inside the PPO loop.
   */
  private async precomputeForecasts(): Promise<void> {
    if (!this.cachedFeatures) throw new Error("Features must be precomputed first");
    this.deps.logger.info(`Precomputing ${this.cachedFeatures.length} forecasts in batch...`);
    const t0 = Date.now();
    this.cachedForecasts = await this.deps.forecastModel.predictBatch(this.cachedFeatures);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    this.deps.logger.info(`Forecasts cached in ${elapsed}s`);
  }

  private async maybeTrainForecaster(
    input: TrainInput,
    state: ForecasterTrainingState, agentState: AgentCheckpointState,
    createdAt: string
  ): Promise<ForecasterTrainingState> {
    if (state.completedEpochs >= input.forecastEpochs) {
      this.deps.logger.info("Forecaster already at target epochs (skipping)");
      return state;
    }
    this.deps.logger.info(
      `Training forecast model (from epoch ${state.completedEpochs} of ${input.forecastEpochs})`
    );
    const allInputs = this.cachedFeatures!;
    const allTargets = this.cachedTargets!;
    const splitter = new PurgedEmbargoedSplit(input.horizon, EMBARGO_FRACTION);
    const inputSplit = splitter.split(allInputs, VALIDATION_FRACTION);
    const targetSplit = splitter.split(allTargets, VALIDATION_FRACTION);
    this.deps.logger.info(
      `Purged/embargoed split — train: ${inputSplit.train.length}, val: ${inputSplit.validation.length}, purged: ${inputSplit.purgedCount} (horizon=${input.horizon}, embargo=${(EMBARGO_FRACTION * 100).toFixed(1)}%)`
    );

    return await this.deps.forecastModel.train(
      inputSplit.train, targetSplit.train, input.forecastEpochs,
      {
        initialState: state,
        validationData: {
          inputs: inputSplit.validation,
          targets: targetSplit.validation,
        },
        onEpochEnd: async (current) => {
          if (this.shouldCheckpointAt(current.completedEpochs, input.forecastEpochs)) {
            await this.saveCheckpoint("forecaster", input, current, agentState, createdAt);
            this.deps.logger.info(
              `Checkpoint saved (forecaster epoch ${current.completedEpochs}/${input.forecastEpochs})`
            );
          }
        },
      }
    );
  }

  private async maybeTrainAgent(
    series: CandleSeries, input: TrainInput,
    forecasterState: ForecasterTrainingState,
    state: AgentCheckpointState, createdAt: string
  ): Promise<AgentCheckpointState> {
    if (state.completedEpisodes >= input.rlEpisodes) {
      this.deps.logger.info("Agent already at target episodes (skipping)");
      return state;
    }
    this.deps.agent.restoreTrainingState({ updateCount: state.updateCount });
    this.deps.logger.info(
      `Training agent for ${input.rlEpisodes} episodes (from episode ${state.completedEpisodes})`
    );
    let current = { ...state };
    for (let episode = state.completedEpisodes; episode < input.rlEpisodes; episode++) {
      const t0 = Date.now();
      await this.runOneEpisode(series, input);
      const agentInternal = this.deps.agent.getTrainingState();
      current = {
        completedEpisodes: episode + 1,
        updateCount: agentInternal.updateCount,
      };
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      this.deps.logger.info(`Episode ${episode + 1}/${input.rlEpisodes} complete (${elapsed}s)`);
      if (this.shouldCheckpointAt(current.completedEpisodes, input.rlEpisodes)) {
        await this.saveCheckpoint("agent", input, forecasterState, current, createdAt);
        this.deps.logger.info(
          `Checkpoint saved (agent episode ${current.completedEpisodes}/${input.rlEpisodes})`
        );
      }
    }
    return current;
  }

  private shouldCheckpointAt(step: number, total: number): boolean {
    if (!this.deps.checkpoint) return false;
    if (step === total) return true;
    return step % this.deps.checkpointEveryN === 0;
  }

  private async saveCheckpoint(
    phase: TrainingPhase, input: TrainInput,
    forecaster: ForecasterTrainingState,
    agent: AgentCheckpointState,
    createdAt: string
  ): Promise<void> {
    if (!this.deps.checkpoint) return;
    await this.deps.checkpoint.save({
      createdAt,
      phase,
      input: this.snapshotInput(input),
      forecaster,
      agent,
    });
  }

  private snapshotInput(input: TrainInput): TrainInputSnapshot {
    return {
      symbol: input.symbol.toString(),
      historicalCandles: input.historicalCandles,
      windowSize: input.windowSize,
      horizon: input.horizon,
      forecastEpochs: input.forecastEpochs,
      rlEpisodes: input.rlEpisodes,
    };
  }

  private buildFutureReturns(series: CandleSeries, anchorIndex: number, horizon: number): number[] {
    const anchorClose = series.at(anchorIndex).closePrice().toNumber();
    const returns: number[] = [];
    for (let h = 1; h <= horizon; h++) {
      const futureClose = series.at(anchorIndex + h).closePrice().toNumber();
      const rawReturn = (futureClose - anchorClose) / anchorClose;
      returns.push(Math.max(-RETURN_CLIP, Math.min(RETURN_CLIP, rawReturn)));
    }
    return returns;
  }

  private async runOneEpisode(series: CandleSeries, input: TrainInput): Promise<void> {
    const ctx: PositionContext = { position: 0, entryPrice: 0, barsInPosition: 0 };
    const forecasts = this.cachedForecasts!;
    const volatility = this.cachedVolatility!;
    const offset = input.windowSize;
    const end = series.size() - input.horizon;
    for (let i = offset; i < end; i++) {
      const idx = i - offset;
      const forecast = forecasts[idx];
      const state = this.assembleState(series, i, forecast, ctx, volatility[i]);
      const decision = await this.deps.agent.decide(state);

      const currentClose = series.at(i).closePrice().toNumber();
      const effectiveAction = this.applyExitGuards(
        decision.action, ctx, currentClose, input.stopLossPct, input.takeProfitPct
      );
      const reward = this.computeReward(series, i, effectiveAction, ctx, input.slippagePct);
      this.updateContext(ctx, effectiveAction, currentClose);

      this.deps.agent.recordExperience({
        state, actionCode: decision.action.toCode(), reward,
        logProbability: decision.logProbability,
        estimatedValue: decision.estimatedValue,
        isTerminal: i === end - 1,
      });
    }
    await this.deps.agent.updatePolicy();
  }

  private assembleState(
    series: CandleSeries, i: number,
    forecast: ReadonlyArray<number>, ctx: PositionContext,
    volatility: number
  ): ReadonlyArray<number> {
    const candle = series.at(i);
    const close = candle.closePrice().toNumber();
    const unrealizedPnL = this.computeUnrealizedPnL(close, ctx);
    return [
      1 - ctx.position,
      unrealizedPnL,
      Math.min(ctx.barsInPosition / 100, 1),
      (candle.openPrice().toNumber() - close) / close,
      (candle.highPrice().toNumber() - close) / close,
      (candle.lowPrice().toNumber() - close) / close,
      candle.range() / close,
      ctx.position,
      volatility,
      ...forecast.slice(0, 4),
    ];
  }

  private computeUnrealizedPnL(currentClose: number, ctx: PositionContext): number {
    if (ctx.position === 0 || ctx.entryPrice === 0) return 0;
    return (currentClose - ctx.entryPrice) / ctx.entryPrice;
  }

  /**
   * Mirrors TradingCycle.applyExitGuards so the agent learns inside the
   * same exit envelope it will face in TEST and INVEST. Without this the
   * policy could discover entry strategies that only work without a TP cap.
   */
  private applyExitGuards(
    action: TradingAction, ctx: PositionContext,
    currentClose: number, stopLossPct: number, takeProfitPct: number
  ): TradingAction {
    if (ctx.position !== 1) return action;
    const pnl = this.computeUnrealizedPnL(currentClose, ctx);
    if (pnl <= -stopLossPct) return TradingAction.SELL;
    if (pnl >= takeProfitPct) return TradingAction.SELL;
    return action;
  }

  /**
   * Long-only reward, in units of next-candle return:
   *   in position + HOLD/BUY  → priceReturn (continue holding)
   *   in position + SELL      → realized PnL on exit (closes the trade) − fees − round-trip slippage
   *   flat + BUY              → priceReturn − fee − entry slippage
   *   flat + SELL/HOLD        → small idle penalty
   *
   * Slippage is charged on both entry and exit because the live executor
   * eats the spread on every market order. Modeling it here aligns the
   * training environment with PaperExecutor and BinanceLiveExecutor.
   */
  private computeReward(
    series: CandleSeries, i: number,
    action: TradingAction, ctx: PositionContext,
    slippagePct: number
  ): number {
    const currentClose = series.at(i).closePrice().toNumber();
    const nextClose = series.at(i + 1).closePrice().toNumber();
    const priceReturn = (nextClose - currentClose) / currentClose;
    if (ctx.position === 1) {
      if (action.isSell()) {
        const realized = this.computeUnrealizedPnL(currentClose, ctx);
        return realized - 2 * FEE_RATE - 2 * slippagePct;
      }
      return priceReturn;
    }
    if (action.isBuy()) return priceReturn - FEE_RATE - slippagePct;
    return -0.0001;
  }

  private updateContext(ctx: PositionContext, action: TradingAction, currentClose: number): void {
    const newPosition = this.nextPosition(action, ctx.position);
    if (newPosition === ctx.position) {
      if (ctx.position === 1) ctx.barsInPosition++;
      return;
    }
    ctx.position = newPosition;
    if (newPosition === 1) {
      ctx.entryPrice = currentClose;
      ctx.barsInPosition = 0;
    } else {
      ctx.entryPrice = 0;
      ctx.barsInPosition = 0;
    }
  }

  private nextPosition(action: TradingAction, currentPosition: number): number {
    if (currentPosition === 0 && action.isBuy()) return 1;
    if (currentPosition === 1 && action.isSell()) return 0;
    return currentPosition;
  }

  private async persistArtifacts(input: TrainInput): Promise<void> {
    this.deps.logger.info("Saving models");
    await this.deps.storage.saveForecastModel(input.forecastModelPath);
    await this.deps.storage.saveAgent(input.agentPath);
  }
}

export interface TrainDependencies {
  marketData: MarketDataProvider;
  forecastModel: ForecastModel;
  agent: DecisionAgent;
  storage: ModelStorage;
  logger: Logger;
  featureBuilder: FeatureBuilder;
  checkpoint?: CheckpointManager;
  checkpointEveryN: number;
}

export interface TrainInput {
  symbol: TradingSymbol;
  historicalCandles: number;
  windowSize: number;
  horizon: number;
  forecastEpochs: number;
  rlEpisodes: number;
  forecastModelPath: string;
  agentPath: string;
  stopLossPct: number;
  takeProfitPct: number;
  slippagePct: number;
}

interface PositionContext {
  position: number;
  entryPrice: number;
  barsInPosition: number;
}
