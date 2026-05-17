import { Container } from "../Container";
import { Command } from "../Cli";
import { BacktestUseCase } from "../../application/use-cases/BacktestUseCase";

/**
 * CLI command: TEST mode (backtest with real data).
 * Simulates trades on historical Binance candles without spending money.
 * Reports directional accuracy and win rate to validate the model.
 */
export class TestCommand implements Command {
  constructor(private readonly container: Container) {}

  async execute(): Promise<void> {
    const env = this.container.environment;
    const useCase = new BacktestUseCase({
      marketData: this.container.marketData,
      forecastModel: this.container.forecaster,
      agent: this.container.agent,
      storage: this.container.storage,
      logger: this.container.logger,
      risk: this.container.risk,
      featureBuilder: this.container.featureBuilder,
    });
    await useCase.execute({
      symbol: this.container.symbol,
      historicalCandles: 1000,
      windowSize: 64,
      forecastModelPath: "./models/bilstm",
      agentPath: "./models/ppo",
      initialCapital: this.container.initialCapital.toNumber(),
      maxPositionRiskPct: env.maxPositionRiskPct,
      stopLossPct: env.stopLossPct,
    });
  }
}
