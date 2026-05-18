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
 * Use Case: trains the forecast model (BiLSTM+Attention) and decision agent (PPO).
 * TRAIN mode: never touches a real executor.
 *
 * Multi-symbol forecaster training:
 *   The forecaster is fed candles from every symbol in `forecasterSymbols`.
 *   Each symbol's series is split independently (purge + embargo) so a
 *   future BTC candle cannot leak into the BTC train set via the ETH val
 *   set, etc. Train and validation sets are then concatenated.
 *
 * Single-symbol agent training:
 *   PPO trains exclusively on `agentSymbol` because action semantics,
 *   reward magnitudes, and the live executor's holding all assume one
 *   market. Multi-asset RL is a separate research project.
 *
 * Short-term, long-only trading: BUY (open long), SELL (close long), no
 * shorts. Stop-loss and take-profit are enforced during training to mirror
 * the backtest and live trading environment.
 */
export class TrainModelsUseCase {
  private cachedAgentFeatures: FeatureMatrix[] | null = null;
  private cachedAgentForecasts: number[][] | null = null;
  private cachedAgentVolatility: number[] | null = null;
  private cachedForecasterSplit: ForecasterSplit | null = null;

  constructor(private readonly deps: TrainDependencies) {}

  async execute(input: TrainInput): Promise<void> {
    this.deps.logger.info("=== TRAINING MODE started ===");
    this.assertSymbolsValid(input);
    const resumed = await this.tryLoadCheckpoint(input);
    const agentSeries = await this.fetchAgentHistory(input);

    await this.precomputeForecasterDataset(input);
    this.precomputeAgentFeaturesAndVolatility(agentSeries, input);

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

    await this.precomputeAgentForecasts();

    const finalAgent = await this.maybeTrainAgent(
      agentSeries, input, finalForecaster, agentState, createdAt
    );

    await this.persistArtifacts(input);
    await this.saveCheckpoint("done", input, finalForecaster, finalAgent, createdAt);
    this.deps.logger.info("Training complete");
  }

  private assertSymbolsValid(input: TrainInput): void {
    if (input.forecasterSymbols.length === 0) {
      throw new Error("TrainInput.forecasterSymbols must contain at least one symbol");
    }
    const agentInList = input.forecasterSymbols
      .some(s => s.toString() === input.agentSymbol.toString());
    if (!agentInList) {
      throw new Error(
        `agentSymbol ${input.agentSymbol.toString()} must also appear in forecasterSymbols`
      );
    }
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
    if (current.agentSymbol.toString() !== saved.agentSymbol) {
      log.warn(`agentSymbol changed: ${saved.agentSymbol} → ${current.agentSymbol.toString()}`);
    }
    const currentSymbols = current.forecasterSymbols.map(s => s.toString()).sort().join(",");
    const savedSymbols = [...saved.forecasterSymbols].sort().join(",");
    if (currentSymbols !== savedSymbols) {
      log.warn(`forecasterSymbols changed: [${savedSymbols}] → [${currentSymbols}]`);
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

  private async fetchAgentHistory(input: TrainInput): Promise<CandleSeries> {
    const total = input.historicalCandles + BACKTEST_HOLDOUT_CANDLES;
    this.deps.logger.info(
      `[agent ${input.agentSymbol.toString()}] downloading ${total} candles (${input.historicalCandles} train + ${BACKTEST_HOLDOUT_CANDLES} holdout)`
    );
    const full = await this.deps.marketData.fetchRecentCandles(input.agentSymbol, total, 0);
    return full.rangeFromIndex(0, full.size() - BACKTEST_HOLDOUT_CANDLES);
  }

  private async fetchForecasterHistory(
    symbol: TradingSymbol, input: TrainInput
  ): Promise<CandleSeries> {
    const total = input.historicalCandles + BACKTEST_HOLDOUT_CANDLES;
    this.deps.logger.info(
      `[forecaster ${symbol.toString()}] downloading ${total} candles`
    );
    const full = await this.deps.marketData.fetchRecentCandles(symbol, total, 0);
    // The same holdout slice removed for the agent must also be removed
    // from every forecaster symbol, otherwise the model could see, during
    // training, the very candles that will appear in TEST mode.
    return full.rangeFromIndex(0, full.size() - BACKTEST_HOLDOUT_CANDLES);
  }

  /**
   * Builds features + targets for every forecaster symbol, applies a
   * per-symbol purged/embargoed split, then concatenates train and
   * validation sets across symbols. Per-symbol splitting prevents
   * cross-symbol leakage: a late BTC candle never trains a model whose
   * BTC validation set contains adjacent samples.
   */
  private async precomputeForecasterDataset(input: TrainInput): Promise<void> {
    if (this.cachedForecasterSplit) return;
    const splitter = new PurgedEmbargoedSplit(input.horizon, EMBARGO_FRACTION);
    const trainInputs: FeatureMatrix[] = [];
    const trainTargets: number[][] = [];
    const valInputs: FeatureMatrix[] = [];
    const valTargets: number[][] = [];
    let totalPurged = 0;

    for (const symbol of input.forecasterSymbols) {
      const series = await this.fetchForecasterHistory(symbol, input);
      const { features, targets } = this.buildSamples(series, input);
      const inputSplit = splitter.split(features, VALIDATION_FRACTION);
      const targetSplit = splitter.split(targets, VALIDATION_FRACTION);
      trainInputs.push(...inputSplit.train);
      trainTargets.push(...targetSplit.train);
      valInputs.push(...inputSplit.validation);
      valTargets.push(...targetSplit.validation);
      totalPurged += inputSplit.purgedCount;
      this.deps.logger.info(
        `[forecaster ${symbol.toString()}] train=${inputSplit.train.length}, val=${inputSplit.validation.length}, purged=${inputSplit.purgedCount}`
      );
    }

    this.cachedForecasterSplit = {
      trainInputs, trainTargets, valInputs, valTargets, totalPurged,
    };
    this.deps.logger.info(
      `Forecaster dataset assembled — train: ${trainInputs.length}, val: ${valInputs.length}, total purged: ${totalPurged}`
    );
  }

  /**
   * One-time CPU work for the AGENT series only: PPO trains on a single
   * market, so features/volatility/forecasts are cached per-agent-symbol.
   */
  private precomputeAgentFeaturesAndVolatility(series: CandleSeries, input: TrainInput): void {
    if (this.cachedAgentFeatures && this.cachedAgentVolatility) return;
    this.deps.logger.info(`[agent ${input.agentSymbol.toString()}] precomputing features and volatility...`);
    const t0 = Date.now();
    const { features } = this.buildSamples(series, input);
    this.cachedAgentFeatures = features;
    this.cachedAgentVolatility = this.computeVolatilitySeries(series);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    this.deps.logger.info(`Cached ${features.length} agent feature matrices in ${elapsed}s`);
  }

  private buildSamples(series: CandleSeries, input: TrainInput): SymbolSamples {
    const features: FeatureMatrix[] = [];
    const targets: number[][] = [];
    for (let i = input.windowSize; i < series.size() - input.horizon; i++) {
      const windowStart = Math.max(0, i - input.windowSize - INDICATOR_WARMUP);
      const window = series.rangeFromIndex(windowStart, i);
      features.push(this.deps.featureBuilder.build(window));
      targets.push(this.buildFutureReturns(series, i, input.horizon));
    }
    return { features, targets };
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
   * Single batched GPU call for all forecasts on the agent series, after
   * the BiLSTM is trained. Replaces ~750k individual batch=1 predict()
   * calls inside the PPO loop.
   */
  private async precomputeAgentForecasts(): Promise<void> {
    if (!this.cachedAgentFeatures) throw new Error("Agent features must be precomputed first");
    this.deps.logger.info(`Precomputing ${this.cachedAgentFeatures.length} agent forecasts in batch...`);
    const t0 = Date.now();
    this.cachedAgentForecasts = await this.deps.forecastModel.predictBatch(this.cachedAgentFeatures);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    this.deps.logger.info(`Agent forecasts cached in ${elapsed}s`);
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
    const split = this.cachedForecasterSplit!;

    return await this.deps.forecastModel.train(
      split.trainInputs, split.trainTargets, input.forecastEpochs,
      {
        initialState: state,
        validationData: {
          inputs: split.valInputs,
          targets: split.valTargets,
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
      `Training agent for ${input.rlEpisodes} episodes on ${input.agentSymbol.toString()} (from episode ${state.completedEpisodes})`
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
      agentSymbol: input.agentSymbol.toString(),
      forecasterSymbols: input.forecasterSymbols.map(s => s.toString()),
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
    const forecasts = this.cachedAgentForecasts!;
    const volatility = this.cachedAgentVolatility!;
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
  agentSymbol: TradingSymbol;
  forecasterSymbols: TradingSymbol[];
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

interface SymbolSamples {
  features: FeatureMatrix[];
  targets: number[][];
}

interface ForecasterSplit {
  trainInputs: FeatureMatrix[];
  trainTargets: number[][];
  valInputs: FeatureMatrix[];
  valTargets: number[][];
  totalPurged: number;
}
