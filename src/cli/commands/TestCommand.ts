import { Container } from "../Container";
import { Command } from "../Cli";
import { TradingSessionUseCase } from "../../application/use-cases/TradingSessionUseCase";

/**
 * CLI command: TEST mode (backtest with real data).
 *
 * Identical core (TradingSessionUseCase + TradingCycle) as INVEST.
 * Only the injected adapters differ:
 *   - PaperExecutor instead of BinanceLiveExecutor (no real money)
 *   - HistoricalReplayMarketData instead of BinanceMarketData
 *   - HistoricalClock instead of SystemClock
 *   - BacktestObserver instead of LiveLogObserver
 *
 * Before the session loop, ForecastSanityCheck runs over the first
 * SANITY_CANDLES candles and logs predMean/predStd/directional accuracy
 * so a collapsed forecaster is visible up front.
 */
export class TestCommand implements Command {
  private static readonly HISTORICAL_CANDLES = 1000;
  private static readonly SANITY_CANDLES = 200;
  private static readonly SANITY_SAMPLES = 100;
  private static readonly WINDOW_SIZE = 128;

  constructor(private readonly container: Container) {}

  async execute(): Promise<void> {
    const replay = await this.container.buildReplaySetup(
      TestCommand.HISTORICAL_CANDLES,
      TestCommand.SANITY_CANDLES,
      TestCommand.WINDOW_SIZE
    );
    await this.container.storage.loadForecastModel("./models/bilstm");
    await this.container.storage.loadAgent("./models/ppo");
    await this.container.buildForecastSanityCheck().run({
      series: replay.calibrationSeries,
      forecaster: this.container.forecaster,
      featureBuilder: this.container.featureBuilder,
      logger: this.container.logger,
      samples: TestCommand.SANITY_SAMPLES,
    });
    const executor = this.container.buildPaperExecutor();
    const cycle = this.container.buildTradingCycle(executor, replay.marketData);
    const useCase = new TradingSessionUseCase({
      cycle,
      clock: replay.clock,
      executor,
      observer: replay.observer,
      risk: this.container.risk,
      storage: this.container.storage,
      logger: this.container.logger,
      symbol: this.container.symbol,
      marketData: replay.marketData,
    });
    await useCase.execute({
      forecastModelPath: "./models/bilstm",
      agentPath: "./models/ppo",
      retryDelayMs: 0,
      mode: "TEST",
    });
  }
}
