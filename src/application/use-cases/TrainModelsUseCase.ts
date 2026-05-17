import { MarketDataProvider } from "../../domain/ports/MarketDataProvider";
import { ForecastModel, ForecasterTrainingState } from "../../domain/ports/ForecastModel";
import { DecisionAgent } from "../../domain/ports/DecisionAgent";
import { ModelStorage } from "../../domain/ports/ModelStorage";
import { Logger } from "../../domain/ports/Logger";
import { FeatureBuilder } from "../services/FeatureBuilder";
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

/**
 * Use Case: trains the forecast model (BiLSTM) and decision agent (PPO).
 * TRAIN mode: never touches a real executor.
 *
 * Supports optional checkpointing: if `deps.checkpoint` is provided, training
 * resumes from a saved state (if present) and saves a new checkpoint every
 * `checkpointEveryN` epochs (forecaster) or episodes (agent).
 */
export class TrainModelsUseCase {
  constructor(private readonly deps: TrainDependencies) {}

  async execute(input: TrainInput): Promise<void> {
    this.deps.logger.info("=== TRAINING MODE started ===");
    const resumed = await this.tryLoadCheckpoint(input);
    const series = await this.fetchHistory(input);

    const forecasterState: ForecasterTrainingState = resumed?.forecaster ?? {
      completedEpochs: 0, bestValLoss: Infinity, patienceCount: 0,
    };
    const agentState: AgentCheckpointState = resumed?.agent ?? {
      completedEpisodes: 0, updateCount: 0,
    };
    const createdAt = resumed?.createdAt ?? new Date().toISOString();

    const finalForecaster = await this.maybeTrainForecaster(
      series, input, forecasterState, agentState, createdAt
    );

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
    this.deps.logger.info(`Downloading ${input.historicalCandles} candles`);
    return await this.deps.marketData.fetchRecentCandles(
      input.symbol, input.historicalCandles
    );
  }

  private async maybeTrainForecaster(
    series: CandleSeries, input: TrainInput,
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
    const { inputs, targets } = this.buildTrainingSet(series, input);
    this.deps.logger.info(`Training samples: ${inputs.length}`);

    return await this.deps.forecastModel.train(
      inputs, targets, input.forecastEpochs,
      {
        initialState: state,
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
      await this.runOneEpisode(series, input);
      const agentInternal = this.deps.agent.getTrainingState();
      current = {
        completedEpisodes: episode + 1,
        updateCount: agentInternal.updateCount,
      };
      this.deps.logger.info(`Episode ${episode + 1}/${input.rlEpisodes} complete`);
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
    if (step === total) return true; // always checkpoint final step of a phase
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

  private buildTrainingSet(series: CandleSeries, input: TrainInput): TrainingSet {
    const inputs: FeatureMatrix[] = [];
    const targets: number[][] = [];
    for (let i = input.windowSize; i < series.size() - input.horizon; i++) {
      // Bounded window: indicator warmup + windowSize for features.
      // Before: rangeFromIndex(0, i) recomputed EMA/RSI/MACD over the full growing series (O(n²)).
      const windowStart = Math.max(0, i - input.windowSize - INDICATOR_WARMUP);
      const window = series.rangeFromIndex(windowStart, i);
      inputs.push(this.deps.featureBuilder.build(window));
      targets.push(this.buildFutureReturns(series, i, input.horizon));
    }
    return { inputs, targets };
  }

  private buildFutureReturns(series: CandleSeries, anchorIndex: number, horizon: number): number[] {
    const anchorClose = series.at(anchorIndex).closePrice().toNumber();
    const returns: number[] = [];
    for (let h = 1; h <= horizon; h++) {
      const futureClose = series.at(anchorIndex + h).closePrice().toNumber();
      const rawReturn = (futureClose - anchorClose) / anchorClose;
      // Clipping prevents extreme outliers from dominating the gradient.
      returns.push(Math.max(-RETURN_CLIP, Math.min(RETURN_CLIP, rawReturn)));
    }
    return returns;
  }

  private async runOneEpisode(series: CandleSeries, input: TrainInput): Promise<void> {
    const ctx: PositionContext = { position: 0, entryPrice: 0, barsInPosition: 0 };
    for (let i = input.windowSize; i < series.size() - input.horizon; i++) {
      const windowStart = Math.max(0, i - input.windowSize - INDICATOR_WARMUP);
      const window = series.rangeFromIndex(windowStart, i);
      const features = this.deps.featureBuilder.build(window);
      const forecast = await this.deps.forecastModel.predict(features);
      const state = this.assembleState(series, i, forecast, ctx);
      const decision = await this.deps.agent.decide(state);
      const reward = this.computeReward(series, i, decision.action, ctx.position);
      this.updateContext(ctx, decision.action, series.at(i).closePrice().toNumber());
      this.deps.agent.recordExperience({
        state, actionCode: decision.action.toCode(), reward,
        logProbability: decision.logProbability,
        estimatedValue: decision.estimatedValue,
        isTerminal: i === series.size() - input.horizon - 1,
      });
    }
    await this.deps.agent.updatePolicy();
  }

  private assembleState(
    series: CandleSeries, i: number,
    forecast: ReadonlyArray<number>, ctx: PositionContext
  ): ReadonlyArray<number> {
    const candle = series.at(i);
    const close = candle.closePrice().toNumber();
    const unrealizedPnL = this.computeUnrealizedPnL(close, ctx);
    return [
      1 - Math.abs(ctx.position),                      // cash ratio (1 = no position)
      unrealizedPnL,                                   // unrealized PnL
      Math.min(ctx.barsInPosition / 100, 1),           // time in position (normalized)
      (candle.openPrice().toNumber() - close) / close,
      (candle.highPrice().toNumber() - close) / close,
      (candle.lowPrice().toNumber() - close) / close,
      candle.range() / close,
      ctx.position === 1 ? 1 : 0,
      ctx.position === -1 ? 1 : 0,
      this.recentVolatility(series, i),                // recent volatility
      ...forecast.slice(0, 4),
    ];
  }

  private computeUnrealizedPnL(currentClose: number, ctx: PositionContext): number {
    if (ctx.position === 0 || ctx.entryPrice === 0) return 0;
    const rawPnL = (currentClose - ctx.entryPrice) / ctx.entryPrice;
    return ctx.position === 1 ? rawPnL : -rawPnL;
  }

  private recentVolatility(series: CandleSeries, i: number): number {
    const start = Math.max(1, i - VOLATILITY_WINDOW);
    const returns: number[] = [];
    for (let k = start; k <= i; k++) {
      const prev = series.at(k - 1).closePrice().toNumber();
      const curr = series.at(k).closePrice().toNumber();
      returns.push((curr - prev) / prev);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  }

  private computeReward(
    series: CandleSeries, i: number,
    action: TradingAction, position: number
  ): number {
    const currentClose = series.at(i).closePrice().toNumber();
    const nextClose = series.at(i + 1).closePrice().toNumber();
    const priceReturn = (nextClose - currentClose) / currentClose;
    if (position === 1) return priceReturn - 0.001;
    if (position === -1) return -priceReturn - 0.001;
    if (action.isBuy() || action.isSell()) return priceReturn * 0.5;
    return -0.0001;
  }

  private updateContext(ctx: PositionContext, action: TradingAction, currentClose: number): void {
    const newPosition = this.nextPosition(action, ctx.position);
    if (newPosition !== ctx.position) {
      ctx.entryPrice = newPosition === 0 ? 0 : currentClose;
      ctx.barsInPosition = 0;
    } else if (ctx.position !== 0) {
      ctx.barsInPosition++;
    }
    ctx.position = newPosition;
  }

  private nextPosition(action: TradingAction, currentPosition: number): number {
    if (action.isBuy()) return 1;
    if (action.isSell()) return -1;
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
}

interface TrainingSet {
  inputs: FeatureMatrix[];
  targets: number[][];
}

interface PositionContext {
  position: number;
  entryPrice: number;
  barsInPosition: number;
}
