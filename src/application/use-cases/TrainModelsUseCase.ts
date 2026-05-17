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
// Trading fee on each side (matches backtest and exchange reality).
const FEE_RATE = 0.001;
// Skip the most recent N candles when fetching training data so they remain
// strictly out-of-sample for the backtest. Backtest then fetches these same
// N candles via endOffsetCandles=0 (default).
const BACKTEST_HOLDOUT_CANDLES = 1000;

/**
 * Use Case: trains the forecast model (BiLSTM) and decision agent (PPO).
 * TRAIN mode: never touches a real executor.
 *
 * Short-term, long-only trading: the agent can only enter long (BUY) and
 * exit long (SELL). No short selling. Stop loss is enforced during training
 * to mirror the backtest and live trading environment.
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
    this.deps.logger.info(
      `Downloading ${input.historicalCandles} candles ` +
      `(skipping last ${BACKTEST_HOLDOUT_CANDLES} as backtest holdout)`
    );
    return await this.deps.marketData.fetchRecentCandles(
      input.symbol, input.historicalCandles, BACKTEST_HOLDOUT_CANDLES
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

      const currentClose = series.at(i).closePrice().toNumber();
      const effectiveAction = this.applyStopLoss(decision.action, ctx, currentClose, input.stopLossPct);
      const reward = this.computeReward(series, i, effectiveAction, ctx);
      this.updateContext(ctx, effectiveAction, currentClose);

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
      1 - ctx.position,                                // cash ratio (1 = flat)
      unrealizedPnL,                                   // unrealized PnL (0 if flat)
      Math.min(ctx.barsInPosition / 100, 1),           // normalized time in position
      (candle.openPrice().toNumber() - close) / close,
      (candle.highPrice().toNumber() - close) / close,
      (candle.lowPrice().toNumber() - close) / close,
      candle.range() / close,
      ctx.position,                                    // 1 if long, 0 if flat
      this.recentVolatility(series, i),
      ...forecast.slice(0, 4),
    ];
  }

  private computeUnrealizedPnL(currentClose: number, ctx: PositionContext): number {
    if (ctx.position === 0 || ctx.entryPrice === 0) return 0;
    return (currentClose - ctx.entryPrice) / ctx.entryPrice;
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

  private applyStopLoss(
    action: TradingAction, ctx: PositionContext,
    currentClose: number, stopLossPct: number
  ): TradingAction {
    if (ctx.position !== 1) return action;
    const pnl = this.computeUnrealizedPnL(currentClose, ctx);
    if (pnl <= -stopLossPct) return TradingAction.SELL;
    return action;
  }

  /**
   * Long-only reward, in units of next-candle return:
   *   in position + HOLD/BUY  → priceReturn - feeDrag (continue holding)
   *   in position + SELL      → realized PnL on exit (closes the trade)
   *   flat + BUY              → priceReturn - feeEntry (entry reward)
   *   flat + SELL/HOLD        → small idle penalty (invalid SELL or no signal)
   */
  private computeReward(
    series: CandleSeries, i: number,
    action: TradingAction, ctx: PositionContext
  ): number {
    const currentClose = series.at(i).closePrice().toNumber();
    const nextClose = series.at(i + 1).closePrice().toNumber();
    const priceReturn = (nextClose - currentClose) / currentClose;
    if (ctx.position === 1) {
      if (action.isSell()) {
        const realized = this.computeUnrealizedPnL(currentClose, ctx);
        return realized - 2 * FEE_RATE;
      }
      return priceReturn;
    }
    if (action.isBuy()) return priceReturn - FEE_RATE;
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

  /**
   * Long-only state machine:
   *   flat (0) + BUY  → long (1)
   *   long (1) + SELL → flat (0)
   *   all other transitions: no change.
   */
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
