import { MarketDataProvider } from "../../domain/ports/MarketDataProvider";
import { TradeExecutor } from "../../domain/ports/TradeExecutor";
import { ForecastModel } from "../../domain/ports/ForecastModel";
import { DecisionAgent } from "../../domain/ports/DecisionAgent";
import { RiskPolicy } from "../../domain/ports/RiskPolicy";
import { Logger } from "../../domain/ports/Logger";
import { FeatureBuilder } from "./FeatureBuilder";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { TradingAction } from "../../domain/enums/TradingAction";
import { Order } from "../../domain/entities/Order";
import { Quantity } from "../../domain/value-objects/Quantity";
import { Price } from "../../domain/value-objects/Price";
import { Money } from "../../domain/value-objects/Money";

/**
 * Service: a single decision-and-execution cycle.
 * SRP: orchestrates one trading tick. Unaware of exchange or model details.
 */
export class TradingCycle {
  constructor(
    private readonly dependencies: TradingCycleDependencies,
    private readonly configuration: TradingCycleConfig
  ) {}

  async executeOnce(): Promise<CycleResult> {
    const series = await this.dependencies.marketData.fetchRecentCandles(
      this.configuration.symbol, 200
    );
    const features = this.dependencies.featureBuilder.build(series);
    const forecast = await this.dependencies.forecastModel.predict(features);
    const stateFeatures = this.buildStateVector(series, forecast);
    const decision = await this.dependencies.agent.decide(stateFeatures);
    const currentPrice = series.last().closePrice();
    return await this.executeDecision(decision.action, currentPrice);
  }

  private buildStateVector(
    series: import("../../domain/collections/CandleSeries").CandleSeries,
    forecast: ReadonlyArray<number>
  ): ReadonlyArray<number> {
    const lastCandle = series.last();
    const close = lastCandle.closePrice().toNumber();
    return [
      0.5, 0, 0,
      (lastCandle.openPrice().toNumber() - close) / close,
      (lastCandle.highPrice().toNumber() - close) / close,
      (lastCandle.lowPrice().toNumber() - close) / close,
      lastCandle.range() / close,
      0, 0, 0,
      ...forecast.slice(0, 4),
    ];
  }

  private async executeDecision(
    action: TradingAction,
    currentPrice: Price
  ): Promise<CycleResult> {
    const cash = await this.dependencies.executor.fetchCashBalance();
    if (!this.dependencies.risk.approve(action, cash)) {
      this.dependencies.logger.warn("Action rejected by risk policy");
      return this.holdResult(action, currentPrice);
    }
    if (action.isBuy()) return await this.performBuy(currentPrice, cash);
    if (action.isSell()) return await this.performSell(currentPrice);
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
}

export interface CycleResult {
  action: TradingAction;
  price: Price;
  order: Order | null;
}
