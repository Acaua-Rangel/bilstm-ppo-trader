import { MarketDataProvider } from "../../domain/ports/MarketDataProvider";
import { ForecastModel } from "../../domain/ports/ForecastModel";
import { DecisionAgent } from "../../domain/ports/DecisionAgent";
import { ModelStorage } from "../../domain/ports/ModelStorage";
import { Logger } from "../../domain/ports/Logger";
import { FeatureBuilder } from "../services/FeatureBuilder";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { CandleSeries } from "../../domain/collections/CandleSeries";
import { TradingAction } from "../../domain/enums/TradingAction";

const INDICATOR_WARMUP = 200;
const VOLATILITY_WINDOW = 20;
const FEE_RATE = 0.001;
const TARGET_MIN_RATE = 0.52;
const TARGET_MAX_RATE = 0.75;

/**
 * Use Case: backtest over real historical data.
 * Measures directional accuracy of the forecaster and trade win rate of the agent.
 * TEST mode: uses real Binance data but never touches money.
 */
export class BacktestUseCase {
  constructor(private readonly deps: BacktestDependencies) {}

  async execute(input: BacktestInput): Promise<BacktestReport> {
    this.deps.logger.info("=== TEST MODE (backtest with real data) ===");
    await this.loadModels(input);
    const series = await this.fetchHistory(input);
    const report = await this.runBacktest(series, input);
    this.printReport(report, input.initialCapital);
    return report;
  }

  private async loadModels(input: BacktestInput): Promise<void> {
    await this.deps.storage.loadForecastModel(input.forecastModelPath);
    await this.deps.storage.loadAgent(input.agentPath);
    this.deps.logger.info("Models loaded");
  }

  private async fetchHistory(input: BacktestInput): Promise<CandleSeries> {
    this.deps.logger.info(`Downloading ${input.historicalCandles} real candles for backtest`);
    return await this.deps.marketData.fetchRecentCandles(
      input.symbol, input.historicalCandles
    );
  }

  private async runBacktest(series: CandleSeries, input: BacktestInput): Promise<BacktestReport> {
    const ctx = this.initialContext(input.initialCapital);
    const stats = this.initialStats();
    const end = series.size() - 1;
    for (let i = input.windowSize; i < end; i++) {
      await this.runStep(series, i, input, ctx, stats);
    }
    if (ctx.position !== 0) {
      this.closePosition(series.at(end).closePrice().toNumber(), ctx, stats);
    }
    return this.buildReport(stats, input.initialCapital, ctx.cash);
  }

  private async runStep(
    series: CandleSeries, i: number, input: BacktestInput,
    ctx: BacktestContext, stats: BacktestStats
  ): Promise<void> {
    const windowStart = Math.max(0, i - input.windowSize - INDICATOR_WARMUP);
    const window = series.rangeFromIndex(windowStart, i);
    const features = this.deps.featureBuilder.build(window);
    const forecast = await this.deps.forecastModel.predict(features);
    const state = this.assembleState(series, i, forecast, ctx);
    const decision = await this.deps.agent.decide(state);
    this.trackDirectionalAccuracy(series, i, forecast, stats);
    this.simulateExecution(series, i, decision.action, ctx, stats);
  }

  private trackDirectionalAccuracy(
    series: CandleSeries, i: number,
    forecast: ReadonlyArray<number>, stats: BacktestStats
  ): void {
    const currentClose = series.at(i).closePrice().toNumber();
    const nextClose = series.at(i + 1).closePrice().toNumber();
    const actualReturn = nextClose - currentClose;
    const predicted = forecast[0];
    if (Math.sign(predicted) === Math.sign(actualReturn) && actualReturn !== 0) {
      stats.directionalHits++;
    }
    stats.directionalTotal++;
  }

  private simulateExecution(
    series: CandleSeries, i: number, action: TradingAction,
    ctx: BacktestContext, stats: BacktestStats
  ): void {
    const price = series.at(i).closePrice().toNumber();
    if (action.isBuy() && ctx.position === 0 && ctx.cash > 0) {
      this.openLong(price, ctx);
    } else if (action.isSell() && ctx.position === 1) {
      this.closePosition(price, ctx, stats);
    }
  }

  private openLong(price: number, ctx: BacktestContext): void {
    const grossQty = ctx.cash / price;
    ctx.holding = grossQty * (1 - FEE_RATE);
    ctx.cash = 0;
    ctx.entryPrice = price;
    ctx.position = 1;
  }

  private closePosition(price: number, ctx: BacktestContext, stats: BacktestStats): void {
    const grossRevenue = ctx.holding * price;
    const netRevenue = grossRevenue * (1 - FEE_RATE);
    const tradePnL = netRevenue - ctx.holding * ctx.entryPrice;
    if (tradePnL > 0) stats.wins++; else stats.losses++;
    stats.totalTrades++;
    stats.totalTradePnL += tradePnL;
    ctx.cash = netRevenue;
    ctx.holding = 0;
    ctx.position = 0;
    ctx.entryPrice = 0;
  }

  private assembleState(
    series: CandleSeries, i: number,
    forecast: ReadonlyArray<number>, ctx: BacktestContext
  ): ReadonlyArray<number> {
    const candle = series.at(i);
    const close = candle.closePrice().toNumber();
    const unrealizedPnL = this.computeUnrealizedPnL(close, ctx);
    return [
      1 - Math.abs(ctx.position),
      unrealizedPnL,
      Math.min(ctx.barsInPosition / 100, 1),
      (candle.openPrice().toNumber() - close) / close,
      (candle.highPrice().toNumber() - close) / close,
      (candle.lowPrice().toNumber() - close) / close,
      candle.range() / close,
      ctx.position === 1 ? 1 : 0,
      ctx.position === -1 ? 1 : 0,
      this.recentVolatility(series, i),
      ...forecast.slice(0, 4),
    ];
  }

  private computeUnrealizedPnL(currentClose: number, ctx: BacktestContext): number {
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

  private buildReport(
    stats: BacktestStats, initialCapital: number, finalCash: number
  ): BacktestReport {
    const directionalAccuracy = stats.directionalTotal === 0
      ? 0 : stats.directionalHits / stats.directionalTotal;
    const winRate = stats.totalTrades === 0
      ? 0 : stats.wins / stats.totalTrades;
    const totalReturnPct = ((finalCash - initialCapital) / initialCapital) * 100;
    return {
      directionalAccuracy, directionalSamples: stats.directionalTotal,
      winRate, totalTrades: stats.totalTrades, wins: stats.wins, losses: stats.losses,
      totalReturnPct, finalEquity: finalCash, tradePnL: stats.totalTradePnL,
      withinTargetRange: this.isWithinTarget(winRate, stats.totalTrades),
    };
  }

  private isWithinTarget(winRate: number, totalTrades: number): boolean {
    if (totalTrades < 5) return false;
    return winRate >= TARGET_MIN_RATE && winRate <= TARGET_MAX_RATE;
  }

  private printReport(report: BacktestReport, initialCapital: number): void {
    const log = this.deps.logger;
    log.info("=== BACKTEST REPORT ===");
    log.info(`Directional accuracy (forecaster): ${(report.directionalAccuracy * 100).toFixed(2)}% (${report.directionalSamples} predictions)`);
    log.info(`Win rate (closed trades): ${(report.winRate * 100).toFixed(2)}% (${report.wins}W / ${report.losses}L across ${report.totalTrades} trades)`);
    log.info(`Accumulated trade PnL: ${report.tradePnL.toFixed(2)} USD`);
    log.info(`Final equity: ${report.finalEquity.toFixed(2)} USD (initial: ${initialCapital.toFixed(2)})`);
    log.info(`Total return: ${report.totalReturnPct.toFixed(2)}%`);
    log.info(this.targetVerdict(report));
  }

  private targetVerdict(report: BacktestReport): string {
    if (report.totalTrades < 5) {
      return `[WARNING] Only ${report.totalTrades} trade(s) — insufficient sample to validate win rate.`;
    }
    const pct = (report.winRate * 100).toFixed(2);
    if (report.withinTargetRange) {
      return `[OK] Win rate ${pct}% is within target range (52% - 75%).`;
    }
    if (report.winRate < TARGET_MIN_RATE) {
      return `[BELOW] Win rate ${pct}% < 52%. Model does not beat random consistently — consider more training or adjustments.`;
    }
    return `[ABOVE] Win rate ${pct}% > 75%. Suspect overfitting or data leakage.`;
  }

  private initialContext(initialCapital: number): BacktestContext {
    return { position: 0, entryPrice: 0, barsInPosition: 0, cash: initialCapital, holding: 0 };
  }

  private initialStats(): BacktestStats {
    return { directionalHits: 0, directionalTotal: 0, wins: 0, losses: 0, totalTrades: 0, totalTradePnL: 0 };
  }
}

export interface BacktestDependencies {
  marketData: MarketDataProvider;
  forecastModel: ForecastModel;
  agent: DecisionAgent;
  storage: ModelStorage;
  logger: Logger;
  featureBuilder: FeatureBuilder;
}

export interface BacktestInput {
  symbol: TradingSymbol;
  historicalCandles: number;
  windowSize: number;
  forecastModelPath: string;
  agentPath: string;
  initialCapital: number;
}

export interface BacktestReport {
  directionalAccuracy: number;
  directionalSamples: number;
  winRate: number;
  totalTrades: number;
  wins: number;
  losses: number;
  totalReturnPct: number;
  finalEquity: number;
  tradePnL: number;
  withinTargetRange: boolean;
}

interface BacktestContext {
  position: number;
  entryPrice: number;
  barsInPosition: number;
  cash: number;
  holding: number;
}

interface BacktestStats {
  directionalHits: number;
  directionalTotal: number;
  wins: number;
  losses: number;
  totalTrades: number;
  totalTradePnL: number;
}
