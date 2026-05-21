import { ConsoleLogger } from "../infrastructure/logging/ConsoleLogger";
import { BinanceMarketData } from "../infrastructure/market-data/BinanceMarketData";
import { HistoricalReplayMarketData } from "../infrastructure/market-data/HistoricalReplayMarketData";
import { BiLSTMForecaster } from "../infrastructure/models/BiLSTMForecaster";
import { PPODecisionAgent } from "../infrastructure/models/PPODecisionAgent";
import { ConservativeRiskPolicy } from "../infrastructure/risk/ConservativeRiskPolicy";
import { PaperExecutor } from "../infrastructure/execution/PaperExecutor";
import { BinanceLiveExecutor } from "../infrastructure/execution/BinanceLiveExecutor";
import { FileModelStorage } from "../infrastructure/storage/FileModelStorage";
import { SystemClock } from "../infrastructure/clock/SystemClock";
import { HistoricalClock } from "../infrastructure/clock/HistoricalClock";
import { PlaybackCursor } from "../infrastructure/clock/PlaybackCursor";
import { LiveLogObserver } from "../infrastructure/observers/LiveLogObserver";
import { BacktestObserver } from "../infrastructure/observers/BacktestObserver";
import { FeatureBuilder } from "../application/services/FeatureBuilder";
import { TradingCycle } from "../application/services/TradingCycle";
import { ForecastSanityCheck } from "../application/services/ForecastSanityCheck";
import { RuntimeStateStore } from "../infrastructure/storage/RuntimeStateStore";
import { CandleSeries } from "../domain/collections/CandleSeries";
import { TradingSymbol } from "../domain/value-objects/TradingSymbol";
import { Money } from "../domain/value-objects/Money";
import { Logger } from "../domain/ports/Logger";
import { TradeExecutor } from "../domain/ports/TradeExecutor";
import { MarketDataProvider } from "../domain/ports/MarketDataProvider";
import { Clock } from "../domain/ports/Clock";
import { SessionObserver } from "../domain/ports/SessionObserver";

/**
 * Composition Root: configures all dependencies.
 *
 * Hexagonal architecture: the application core never depends on the
 * concrete adapters chosen here. TEST and INVEST share the same core
 * (TradingSessionUseCase + TradingCycle) and differ only in which
 * adapters this container hands them.
 */
export class Container {
  readonly logger: Logger;
  /** Live market data adapter — also serves as the historical fetcher for TEST setup. */
  readonly marketData: BinanceMarketData;
  readonly forecaster: BiLSTMForecaster;
  readonly agent: PPODecisionAgent;
  readonly risk: ConservativeRiskPolicy;
  readonly storage: FileModelStorage;
  readonly featureBuilder: FeatureBuilder;
  readonly stateStore: RuntimeStateStore;
  readonly symbol: TradingSymbol;
  readonly initialCapital: Money;

  readonly environment: Environment;

  constructor(private readonly env: Environment) {
    this.environment = env;
    this.symbol = TradingSymbol.of(env.tradingSymbol);
    this.initialCapital = Money.of(env.initialCapitalUsd);
    this.logger = new ConsoleLogger();
    this.marketData = new BinanceMarketData(env.timeframe);
    this.featureBuilder = new FeatureBuilder(128);
    this.forecaster = new BiLSTMForecaster();
    this.agent = new PPODecisionAgent();
    this.risk = new ConservativeRiskPolicy(this.riskConfig());
    this.storage = new FileModelStorage(this.forecaster, this.agent);
    this.stateStore = new RuntimeStateStore(env.stateFilePath, this.logger);
  }

  // --- Live (INVEST) wiring ----------------------------------------------

  buildLiveExecutor(): TradeExecutor {
    return new BinanceLiveExecutor({
      apiKey: this.env.binanceApiKey,
      apiSecret: this.env.binanceApiSecret,
      testnet: this.env.binanceTestnet,
    }, this.logger);
  }

  buildLiveClock(intervalMs: number): Clock {
    return new SystemClock(intervalMs);
  }

  buildLiveObserver(): SessionObserver {
    return new LiveLogObserver(this.logger);
  }

  marketDataProvider(): MarketDataProvider {
    return this.marketData;
  }

  // --- Replay (TEST) wiring ----------------------------------------------

  buildPaperExecutor(): TradeExecutor {
    return new PaperExecutor(this.initialCapital, this.env.slippagePct, this.logger);
  }

  async buildReplaySetup(
    historicalCandles: number,
    calibrationCandles: number,
    windowSize: number
  ): Promise<ReplaySetup> {
    const fullSeries = await this.marketData.fetchRecentCandles(
      this.symbol, historicalCandles, 0
    );
    const startIndex = Math.max(
      Math.min(windowSize, fullSeries.size() - 1),
      Math.min(calibrationCandles, fullSeries.size() - 1)
    );
    const cursor = new PlaybackCursor(startIndex, fullSeries.size() - 1);
    const marketData = new HistoricalReplayMarketData(fullSeries, cursor);
    const clock = new HistoricalClock(cursor);
    const observer = new BacktestObserver(this.logger, fullSeries, cursor);
    const calibrationSeries = fullSeries.rangeFromIndex(0, startIndex);
    return { marketData, clock, observer, cursor, calibrationSeries };
  }

  // --- Forecaster sanity check (pre-session diagnostic) -------------------

  buildForecastSanityCheck(): ForecastSanityCheck {
    return new ForecastSanityCheck();
  }

  async fetchSanityCheckSeries(candles: number): Promise<CandleSeries> {
    return await this.marketData.fetchRecentCandles(this.symbol, candles, 0);
  }

  // --- Shared --------------------------------------------------------------

  buildTradingCycle(executor: TradeExecutor, marketData: MarketDataProvider): TradingCycle {
    return new TradingCycle({
      marketData,
      executor, forecastModel: this.forecaster,
      agent: this.agent, risk: this.risk,
      logger: this.logger, featureBuilder: this.featureBuilder,
      stateStore: this.stateStore,
    }, {
      symbol: this.symbol,
      stopLossPct: this.env.stopLossPct,
      takeProfitPct: this.env.takeProfitPct,
    });
  }

  private riskConfig() {
    return {
      maxPositionRiskPct: this.env.maxPositionRiskPct,
      stopLossPct: this.env.stopLossPct,
      takeProfitPct: this.env.takeProfitPct,
      maxDrawdownPct: this.env.maxDailyDrawdownPct,
      slippagePct: this.env.slippagePct,
    };
  }
}

export interface ReplaySetup {
  marketData: HistoricalReplayMarketData;
  clock: Clock;
  observer: SessionObserver;
  cursor: PlaybackCursor;
  /** Candles that precede the backtest range — used by the forecaster sanity check. */
  calibrationSeries: CandleSeries;
}

export interface Environment {
  tradingSymbol: string;
  timeframe: string;
  initialCapitalUsd: number;
  maxPositionRiskPct: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxDailyDrawdownPct: number;
  slippagePct: number;
  binanceApiKey: string;
  binanceApiSecret: string;
  binanceTestnet: boolean;
  stateFilePath: string;
}
