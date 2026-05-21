import { Container } from "../Container";
import { Command } from "../Cli";
import { TradingSessionUseCase } from "../../application/use-cases/TradingSessionUseCase";

/**
 * CLI command: INVEST mode (real money).
 *
 * Identical core (TradingSessionUseCase + TradingCycle) as TEST.
 * Only the injected adapters differ:
 *   - BinanceLiveExecutor (real exchange)
 *   - BinanceMarketData (live candles)
 *   - SystemClock (real wall-clock)
 *   - LiveLogObserver (streams events to the logger)
 *
 * Runtime state (entry price, bars-in-position) is persisted via
 * RuntimeStateStore so a restart inside an open position resumes with
 * the correct SL/TP anchors.
 */
export class InvestCommand implements Command {
  private static readonly INTERVAL_MS = 60 * 60 * 1000;
  private static readonly RETRY_DELAY_MS = 30_000;
  private static readonly SANITY_CANDLES = 400;
  private static readonly SANITY_SAMPLES = 100;

  constructor(private readonly container: Container) {}

  async execute(): Promise<void> {
    this.printWarning();
    const executor = this.container.buildLiveExecutor();
    const marketData = this.container.marketDataProvider();
    await this.container.storage.loadForecastModel("./models/bilstm");
    await this.container.storage.loadAgent("./models/ppo");
    const sanitySeries = await this.container.fetchSanityCheckSeries(
      InvestCommand.SANITY_CANDLES
    );
    await this.container.buildForecastSanityCheck().run({
      series: sanitySeries,
      forecaster: this.container.forecaster,
      featureBuilder: this.container.featureBuilder,
      logger: this.container.logger,
      samples: InvestCommand.SANITY_SAMPLES,
    });
    const cycle = this.container.buildTradingCycle(executor, marketData);
    const useCase = new TradingSessionUseCase({
      cycle,
      clock: this.container.buildLiveClock(InvestCommand.INTERVAL_MS),
      executor,
      observer: this.container.buildLiveObserver(),
      risk: this.container.risk,
      storage: this.container.storage,
      logger: this.container.logger,
      symbol: this.container.symbol,
      marketData,
    });
    await useCase.execute({
      forecastModelPath: "./models/bilstm",
      agentPath: "./models/ppo",
      retryDelayMs: InvestCommand.RETRY_DELAY_MS,
      mode: "INVEST",
    });
  }

  private printWarning(): void {
    console.log(`
+============================================================+
|  WARNING   INVEST MODE — REAL MONEY                        |
|                                                            |
|  The bot will submit real orders to the exchange.          |
|  Circuit breaker will trigger on drawdown > limit.         |
|  Press Ctrl+C for graceful shutdown.                       |
+============================================================+
    `);
  }
}
