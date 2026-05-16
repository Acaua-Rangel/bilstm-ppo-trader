import { MarketDataProvider } from "../../domain/ports/MarketDataProvider";
import { ForecastModel } from "../../domain/ports/ForecastModel";
import { DecisionAgent } from "../../domain/ports/DecisionAgent";
import { ModelStorage } from "../../domain/ports/ModelStorage";
import { Logger } from "../../domain/ports/Logger";
import { FeatureBuilder } from "../services/FeatureBuilder";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { CandleSeries } from "../../domain/collections/CandleSeries";
import { FeatureMatrix } from "../../domain/collections/FeatureMatrix";
import { TradingAction } from "../../domain/enums/TradingAction";

// Warmup buffer for indicators (MACD needs ~50 candles, BB needs 20).
const INDICATOR_WARMUP = 200;
// Return clipping: ±10% per candle removes flash crash outliers.
const RETURN_CLIP = 0.1;
// Window for computing volatility in the agent state.
const VOLATILITY_WINDOW = 20;

/**
 * Use Case: trains the forecast model (BiLSTM) and decision agent (PPO).
 * TRAIN mode: never touches a real executor.
 */
export class TrainModelsUseCase {
  constructor(private readonly deps: TrainDependencies) {}

  async execute(input: TrainInput): Promise<void> {
    this.deps.logger.info("=== TRAINING MODE started ===");
    const series = await this.fetchHistory(input);
    await this.trainForecaster(series, input);
    await this.trainAgent(series, input);
    await this.persistArtifacts(input);
    this.deps.logger.info("Training complete");
  }

  private async fetchHistory(input: TrainInput): Promise<CandleSeries> {
    this.deps.logger.info(`Downloading ${input.historicalCandles} candles`);
    return await this.deps.marketData.fetchRecentCandles(
      input.symbol, input.historicalCandles
    );
  }

  private async trainForecaster(series: CandleSeries, input: TrainInput): Promise<void> {
    this.deps.logger.info("Training forecast model");
    const { inputs, targets } = this.buildTrainingSet(series, input);
    this.deps.logger.info(`Training samples: ${inputs.length}`);
    await this.deps.forecastModel.train(inputs, targets, input.forecastEpochs);
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

  private async trainAgent(series: CandleSeries, input: TrainInput): Promise<void> {
    this.deps.logger.info(`Training agent for ${input.rlEpisodes} episodes`);
    for (let episode = 0; episode < input.rlEpisodes; episode++) {
      await this.runOneEpisode(series, input);
      this.deps.logger.info(`Episode ${episode + 1}/${input.rlEpisodes} complete`);
    }
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
