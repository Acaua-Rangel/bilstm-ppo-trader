import { MarketDataProvider } from "../../domain/ports/MarketDataProvider";
import { TradeExecutor } from "../../domain/ports/TradeExecutor";
import { ForecastModel } from "../../domain/ports/ForecastModel";
import { DecisionAgent } from "../../domain/ports/DecisionAgent";
import { RiskPolicy } from "../../domain/ports/RiskPolicy";
import { Logger } from "../../domain/ports/Logger";
import { FeatureBuilder } from "./FeatureBuilder";
import { CandleSeries } from "../../domain/collections/CandleSeries";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { TradingAction } from "../../domain/enums/TradingAction";
import { Order } from "../../domain/entities/Order";
import { Quantity } from "../../domain/value-objects/Quantity";
import { Price } from "../../domain/value-objects/Price";
import { Money } from "../../domain/value-objects/Money";

const VOLATILITY_WINDOW = 20;

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
    const forecast = await this.dependencies.forecastModel.predict(features);
    const currentPrice = series.last().closePrice();
    const position = await this.detectPosition(currentPrice.toNumber());
    const stateFeatures = this.buildStateVector(series, forecast, position, currentPrice.toNumber());
    const decision = await this.dependencies.agent.decide(stateFeatures);
    const effectiveAction = this.applyStopLoss(decision.action, position, currentPrice.toNumber());
    return await this.executeDecision(effectiveAction, currentPrice, position);
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
  ): Promise<CycleResult> {
    const cash = await this.dependencies.executor.fetchCashBalance();
    if (!this.dependencies.risk.approve(action, cash)) {
      this.dependencies.logger.warn("Action rejected by risk policy");
      return this.holdResult(action, currentPrice);
    }
    if (action.isBuy() && position === 0) return await this.performBuy(currentPrice, cash);
    if (action.isSell() && position === 1) return await this.performSell(currentPrice);
    return this.holdResult(action, currentPrice);
  }

  private async performBuy(price: Price, cash: Money): Promise<CycleResult> {
    const sizing = this.dependencies.risk.positionSizeFor(cash);
    const quantity = Quantity.of(sizing.toNumber() / price.toNumber());
    const order = Order.buy(this.configuration.symbol, quantity, price);
    const filled = await this.dependencies.executor.submit(order);
    this.dependencies.logger.info(`Order filled: ${filled.describe()}`);
    return { action: TradingAction.BUY, price, order: filled };
  }

  private async performSell(price: Price): Promise<CycleResult> {
    const holding = await this.dependencies.executor.fetchHoldingQuantity(
      this.configuration.symbol
    );
    if (holding.isZero()) return this.holdResult(TradingAction.HOLD, price);
    const order = Order.sell(this.configuration.symbol, holding, price);
    const filled = await this.dependencies.executor.submit(order);
    this.dependencies.logger.info(`Order filled: ${filled.describe()}`);
    return { action: TradingAction.SELL, price, order: filled };
  }

  private holdResult(action: TradingAction, price: Price): CycleResult {
    return { action, price, order: null };
  }
}

export interface TradingCycleDependencies {
  marketData: MarketDataProvider;
  executor: TradeExecutor;
  forecastModel: ForecastModel;
  agent: DecisionAgent;
  risk: RiskPolicy;
  logger: Logger;
  featureBuilder: FeatureBuilder;
}

export interface TradingCycleConfig {
  symbol: TradingSymbol;
  stopLossPct: number;
}

export interface CycleResult {
  action: TradingAction;
  price: Price;
  order: Order | null;
}
