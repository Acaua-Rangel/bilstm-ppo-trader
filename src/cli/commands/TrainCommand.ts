import { Container } from "../Container";
import { Command } from "../Cli";
import { TrainModelsUseCase } from "../../application/use-cases/TrainModelsUseCase";

/**
 * CLI command: TRAIN mode.
 * Trains models with historical data. Never touches a real executor.
 */
export class TrainCommand implements Command {
  constructor(private readonly container: Container) {}

  async execute(): Promise<void> {
    const useCase = this.buildUseCase();
    await useCase.execute({
      symbol: this.container.symbol,
      historicalCandles: 5000,
      windowSize: 64,
      horizon: 4,
      forecastEpochs: 50,
      rlEpisodes: 30,
      forecastModelPath: "./models/bilstm",
      agentPath: "./models/ppo",
    });
  }

  private buildUseCase(): TrainModelsUseCase {
    return new TrainModelsUseCase({
      marketData: this.container.marketData,
      forecastModel: this.container.forecaster,
      agent: this.container.agent,
      storage: this.container.storage,
      logger: this.container.logger,
      featureBuilder: this.container.featureBuilder,
    });
  }
}
