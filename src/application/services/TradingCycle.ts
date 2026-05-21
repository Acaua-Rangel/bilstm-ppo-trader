import { MarketDataProvider } from "../../domain/ports/MarketDataProvider";
import { TradeExecutor } from "../../domain/ports/TradeExecutor";
import { ForecastModel } from "../../domain/ports/ForecastModel";
import { DecisionAgent } from "../../domain/ports/DecisionAgent";
import { RiskPolicy } from "../../domain/ports/RiskPolicy";
import { Logger } from "../../domain/ports/Logger";
import { FeatureBuilder } from "./FeatureBuilder";
import { RuntimeStateStore } from "../../infrastructure/storage/RuntimeStateStore";
import { CandleSeries } from "../../domain/collections/CandleSeries";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { TradingAction } from "../../domain/enums/TradingAction";
import { Order } from "../../domain/entities/Order";
import { Quantity } from "../../domain/value-objects/Quantity";
import { Price } from "../../domain/value-objects/Price";
import { Money } from "../../domain/value-objects/Money";

const VOLATILITY_WINDOW = 20;
/**
 * Index into the BiLSTM HORIZON-length output used as the trading signal.
 * 0 = P(up next bar). ForecastSanityCheck and BacktestObserver MUST use
 * the same index — keep them in sync.
 */
export const SIGNAL_HORIZON_INDEX = 0;

/**
 * Service: a single decision-and-execution cycle.
 *
 * Mirrors the training environment as closely as possible:
 *   - 16-feature window fed to the BiLSTM forecaster.
 *   - 13-element state vector fed to the PPO actor.
 *   - Stop-loss / take-profit are hard guards (also in training).
 *   - No regime/probability/confidence gates — the PPO learned to manage
 *     entries on its own via the reward shape (pred_strength term).
 */
export class TradingCycle {
  private entryPrice: number = 0;
  private barsInPosition: number = 0;
  private lastSeenPosition: number = 0;

  constructor(
    private readonly dependencies: TradingCycleDependencies,
    private readonly configuration: TradingCycleConfig
  ) {
    const restored = this.dependencies.stateStore.load();
    if (restored !== null) {
      this.entryPrice = restored.entryPrice;
      this.barsInPosition = restored.barsInPosition;
      this.lastSeenPosition = restored.lastSeenPosition;
      this.dependencies.logger.info("Runtime state restored", {
        entryPrice: restored.entryPrice,
        barsInPosition: restored.barsInPosition,
        lastSeenPosition: restored.lastSeenPosition,
      });
    }
  }

  async executeOnce(): Promise<CycleResult> {
    const series = await this.dependencies.marketData.fetchRecentCandles(
      this.configuration.symbol, 200, 0
    );
    const features = this.dependencies.featureBuilder.build(series);
    const forecast = await this.dependencies.forecastModel.predict(features);
    const currentPrice = series.last().closePrice();
    const position = await this.detectPosition(currentPrice.toNumber());
    const stateFeatures = this.buildStateVector(series, forecast, position, currentPrice.toNumber());
    const decision = await this.dependencies.agent.decide(stateFeatures);

    const candidate = this.applyExitGuards(decision.action, position, currentPrice.toNumber());
    const execution = await this.executeDecision(candidate, currentPrice, position);
    return { ...execution, forecast };
  }

  private async detectPosition(currentPrice: number): Promise<number> {
    const holding = await this.dependencies.executor.fetchHoldingQuantity(
      this.configuration.symbol
    );
    const position = holding.isPositive() ? 1 : 0;
    if (position === 1 && this.lastSeenPosition === 0) {
      // Edge: 0→1 in this cycle (genuine new entry) OR restart with orphan holding
      // (state file missing). The state-store load in the constructor would have
      // restored a valid entryPrice; if it's still 0 here we're in the orphan case.
      if (this.entryPrice === 0) {
        this.entryPrice = currentPrice;
        this.barsInPosition = 0;
        this.dependencies.logger.warn(
          "Orphan position detected on startup (holding > 0, no prior state) — " +
          `using current price ${currentPrice} as entry anchor. SL/TP will be ` +
          "computed relative to the restart price, not the real fill."
        );
      } else {
        this.barsInPosition++;
      }
    } else if (position === 0 && this.lastSeenPosition === 1) {
      this.entryPrice = 0;
      this.barsInPosition = 0;
    } else if (position === 1) {
      this.barsInPosition++;
    }
    this.lastSeenPosition = position;
    this.dependencies.stateStore.save({
      entryPrice: this.entryPrice,
      barsInPosition: this.barsInPosition,
      lastSeenPosition: this.lastSeenPosition,
    });
    return position;
  }

  /**
   * Hard exits — mirror the `apply_exit_guards` in the training notebook:
   * a SELL is forced whenever PnL crosses ±SL/TP, regardless of the agent.
   */
  private applyExitGuards(action: TradingAction, position: number, currentPrice: number): TradingAction {
    if (position !== 1 || this.entryPrice === 0) return action;
    const pnl = (currentPrice - this.entryPrice) / this.entryPrice;
    if (pnl <= -this.configuration.stopLossPct) {
      this.dependencies.logger.warn(
        `Stop loss triggered at ${(pnl * 100).toFixed(2)}% — forcing SELL`
      );
      return TradingAction.SELL;
    }
    if (pnl >= this.configuration.takeProfitPct) {
      this.dependencies.logger.info(
        `Take profit triggered at ${(pnl * 100).toFixed(2)}% — forcing SELL`
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
  stateStore: RuntimeStateStore;
}

export interface TradingCycleConfig {
  symbol: TradingSymbol;
  stopLossPct: number;
  takeProfitPct: number;
}

export interface CycleResult {
  action: TradingAction;
  price: Price;
  order: Order | null;
  forecast: ReadonlyArray<number>;
}
