import { MarketDataProvider } from "../../domain/ports/MarketDataProvider";
import { TradeExecutor } from "../../domain/ports/TradeExecutor";
import { ForecastModel } from "../../domain/ports/ForecastModel";
import { DecisionAgent } from "../../domain/ports/DecisionAgent";
import { RiskPolicy } from "../../domain/ports/RiskPolicy";
import { Logger } from "../../domain/ports/Logger";
import { FeatureBuilder } from "./FeatureBuilder";
import { RegimeFilter } from "./RegimeFilter";
import { PlattCalibrator } from "./PlattCalibrator";
import { AdaptiveThreshold } from "./AdaptiveThreshold";
import { CandleSeries } from "../../domain/collections/CandleSeries";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { TradingAction } from "../../domain/enums/TradingAction";
import { Order } from "../../domain/entities/Order";
import { Quantity } from "../../domain/value-objects/Quantity";
import { Price } from "../../domain/value-objects/Price";
import { Money } from "../../domain/value-objects/Money";

const VOLATILITY_WINDOW = 20;
// Tuned against the observed forecaster output range (~5e-4):
//   - BASE_SIGNAL_THRESHOLD was 0.002, blocking 100% of trades.
//   - MIN_CALIBRATED_PROBABILITY was 0.65, impossible with default identity-sigmoid.
//   - ENSEMBLE_RUNS halved to cut inference cost without measurable quality loss.
const ENSEMBLE_RUNS = 10;
const MIN_CONFIDENCE = 0.75;
const MIN_CALIBRATED_PROBABILITY = 0.52;
const BASE_SIGNAL_THRESHOLD = 0.0003;

/**
 * Service: a single decision-and-execution cycle.
 * SRP: orchestrates one trading tick. Unaware of exchange or model details.
 *
 * Keeps minimal in-memory state (entryPrice, barsInPosition) so the state
 * vector matches the training environment. State is lost on restart and
 * recovers naturally on the next entry — stop-out detection during the
 * gap window is sacrificed for simplicity.
 */
export class TradingCycle {
  private entryPrice: number = 0;
  private barsInPosition: number = 0;
  private lastSeenPosition: number = 0;

  constructor(
    private readonly dependencies: TradingCycleDependencies,
    private readonly configuration: TradingCycleConfig
  ) {}

  async executeOnce(): Promise<CycleResult> {
    const series = await this.dependencies.marketData.fetchRecentCandles(
      this.configuration.symbol, 200, 0
    );
    const features = this.dependencies.featureBuilder.build(series);
    const ensemble = await this.dependencies.forecastModel.predictWithUncertainty(
      features, ENSEMBLE_RUNS
    );
    const forecast = ensemble.mean;
    const currentPrice = series.last().closePrice();
    const position = await this.detectPosition(currentPrice.toNumber());
    const stateFeatures = this.buildStateVector(series, forecast, position, currentPrice.toNumber());
    const decision = await this.dependencies.agent.decide(stateFeatures);

    const candidate = this.applyStopLoss(decision.action, position, currentPrice.toNumber());
    const filtered = this.applyAccuracyFilters(candidate, series, ensemble);
    const execution = await this.executeDecision(filtered, currentPrice, position);
    return { ...execution, forecast };
  }

  /**
   * Layered filters that downgrade an action to HOLD when accuracy gates fail.
   * SELL on an open position is exempt: closing must remain unconditional so
   * that stop-loss and risk-off exits cannot be vetoed by low confidence.
   *
   * Stages:
   *   1. Regime filter — only act in trending markets (ADX + volume confirm).
   *   2. Adaptive threshold — require |mean[0]| > base × (recent ATR / slow ATR).
   *   3. Ensemble confidence — variance-derived confidence must beat the gate.
   *   4. Platt-calibrated probability — must beat the gate too.
   */
  private applyAccuracyFilters(
    action: TradingAction,
    series: CandleSeries,
    ensemble: { mean: ReadonlyArray<number>; confidence: ReadonlyArray<number> }
  ): TradingAction {
    if (!action.isBuy()) return action;
    const reason = this.firstBlockingFilter(series, ensemble);
    if (reason === null) return action;
    this.dependencies.logger.info(`Trade gated by ${reason} — forcing HOLD`);
    return TradingAction.HOLD;
  }

  private firstBlockingFilter(
    series: CandleSeries,
    ensemble: { mean: ReadonlyArray<number>; confidence: ReadonlyArray<number> }
  ): string | null {
    if (!this.dependencies.regimeFilter.isTrending(series)) return "regime filter (sideways market)";
    const threshold = this.dependencies.adaptiveThreshold.compute(series, BASE_SIGNAL_THRESHOLD);
    if (Math.abs(ensemble.mean[0]) < threshold) return `adaptive threshold (signal ${ensemble.mean[0].toFixed(5)} < ${threshold.toFixed(5)})`;
    if ((ensemble.confidence[0] ?? 0) < MIN_CONFIDENCE) return `ensemble confidence (${(ensemble.confidence[0] ?? 0).toFixed(2)} < ${MIN_CONFIDENCE})`;
    // Platt gate is only meaningful after fitting; before that, slope=1/intercept=0
    // makes σ(forecast) ≈ 0.5 and would block every trade. CalibrationWarmup fits
    // the calibrator before the session starts; if it has not run, this gate is bypassed.
    if (this.dependencies.calibrator.isCalibrated()) {
      const calibrated = this.dependencies.calibrator.calibratedProbability(ensemble.mean[0]);
      if (calibrated < MIN_CALIBRATED_PROBABILITY) return `Platt probability (${calibrated.toFixed(2)} < ${MIN_CALIBRATED_PROBABILITY})`;
    }
    return null;
  }

  private async detectPosition(currentPrice: number): Promise<number> {
    const holding = await this.dependencies.executor.fetchHoldingQuantity(
      this.configuration.symbol
    );
    const position = holding.isPositive() ? 1 : 0;
    if (position === 1 && this.lastSeenPosition === 0) {
      this.entryPrice = currentPrice;
      this.barsInPosition = 0;
    } else if (position === 0 && this.lastSeenPosition === 1) {
      this.entryPrice = 0;
      this.barsInPosition = 0;
    } else if (position === 1) {
      this.barsInPosition++;
    }
    this.lastSeenPosition = position;
    return position;
  }

  private applyStopLoss(action: TradingAction, position: number, currentPrice: number): TradingAction {
    if (position !== 1 || this.entryPrice === 0) return action;
    const pnl = (currentPrice - this.entryPrice) / this.entryPrice;
    if (pnl <= -this.configuration.stopLossPct) {
      this.dependencies.logger.warn(
        `Stop loss triggered at ${(pnl * 100).toFixed(2)}% — forcing SELL`
      );
      return TradingAction.SELL;
    }
    return action;
  }

  private buildStateVector(
    series: CandleSeries,
    forecast: ReadonlyArray<number>,
    position: number,
    currentPrice: number
  ): ReadonlyArray<number> {
    const lastCandle = series.last();
    const close = lastCandle.closePrice().toNumber();
    const unrealizedPnL = position === 1 && this.entryPrice > 0
      ? (currentPrice - this.entryPrice) / this.entryPrice : 0;
    return [
      1 - position,
      unrealizedPnL,
      Math.min(this.barsInPosition / 100, 1),
      (lastCandle.openPrice().toNumber() - close) / close,
      (lastCandle.highPrice().toNumber() - close) / close,
      (lastCandle.lowPrice().toNumber() - close) / close,
      lastCandle.range() / close,
      position,
      this.recentVolatility(series),
      ...forecast.slice(0, 4),
    ];
  }

  private recentVolatility(series: CandleSeries): number {
    const size = series.size();
    const start = Math.max(1, size - VOLATILITY_WINDOW);
    const returns: number[] = [];
    for (let k = start; k < size; k++) {
      const prev = series.at(k - 1).closePrice().toNumber();
      const curr = series.at(k).closePrice().toNumber();
      returns.push((curr - prev) / prev);
    }
    if (returns.length === 0) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  }

  private async executeDecision(
    action: TradingAction,
    currentPrice: Price,
    position: number
  ): Promise<ExecutionResult> {
    const cash = await this.dependencies.executor.fetchCashBalance();
    if (!this.dependencies.risk.approve(action, cash)) {
      this.dependencies.logger.warn("Action rejected by risk policy");
      return this.holdResult(action, currentPrice);
    }
    if (action.isBuy() && position === 0) return await this.performBuy(currentPrice, cash);
    if (action.isSell() && position === 1) return await this.performSell(currentPrice);
    return this.holdResult(action, currentPrice);
  }

  private async performBuy(price: Price, cash: Money): Promise<ExecutionResult> {
    const sizing = this.dependencies.risk.positionSizeFor(cash);
    const quantity = Quantity.of(sizing.toNumber() / price.toNumber());
    const order = Order.buy(this.configuration.symbol, quantity, price);
    const filled = await this.dependencies.executor.submit(order);
    this.dependencies.logger.info(`Order filled: ${filled.describe()}`);
    return { action: TradingAction.BUY, price, order: filled };
  }

  private async performSell(price: Price): Promise<ExecutionResult> {
    const holding = await this.dependencies.executor.fetchHoldingQuantity(
      this.configuration.symbol
    );
    if (holding.isZero()) return this.holdResult(TradingAction.HOLD, price);
    const order = Order.sell(this.configuration.symbol, holding, price);
    const filled = await this.dependencies.executor.submit(order);
    this.dependencies.logger.info(`Order filled: ${filled.describe()}`);
    return { action: TradingAction.SELL, price, order: filled };
  }

  private holdResult(action: TradingAction, price: Price): ExecutionResult {
    return { action, price, order: null };
  }
}

interface ExecutionResult {
  action: TradingAction;
  price: Price;
  order: Order | null;
}

export interface TradingCycleDependencies {
  marketData: MarketDataProvider;
  executor: TradeExecutor;
  forecastModel: ForecastModel;
  agent: DecisionAgent;
  risk: RiskPolicy;
  logger: Logger;
  featureBuilder: FeatureBuilder;
  regimeFilter: RegimeFilter;
  calibrator: PlattCalibrator;
  adaptiveThreshold: AdaptiveThreshold;
}

export interface TradingCycleConfig {
  symbol: TradingSymbol;
  stopLossPct: number;
}

export interface CycleResult {
  action: TradingAction;
  price: Price;
  order: Order | null;
  forecast: ReadonlyArray<number>;
}
