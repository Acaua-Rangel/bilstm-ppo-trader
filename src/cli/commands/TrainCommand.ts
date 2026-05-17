import { Container } from "../Container";
import { Command } from "../Cli";
import { TrainModelsUseCase } from "../../application/use-cases/TrainModelsUseCase";

const DEFAULT_CHECKPOINT_EVERY = 5;

/**
 * CLI command: TRAIN mode.
 * Trains models with historical data. Never touches a real executor.
 *
 * Flags (read from process.argv):
 *   --checkpoint=<dir>        save/resume training from this directory
 *   --checkpoint-every=<n>    checkpoint frequency in epochs/episodes (default 5)
 */
export class TrainCommand implements Command {
  constructor(private readonly container: Container) {}

  async execute(): Promise<void> {
    const useCase = this.buildUseCase();
    await useCase.execute({
      symbol: this.container.symbol,
      historicalCandles: 15000,
      windowSize: 64,
      horizon: 4,
      forecastEpochs: 100,
      rlEpisodes: 50,
      forecastModelPath: "./models/bilstm",
      agentPath: "./models/ppo",
      stopLossPct: this.container.environment.stopLossPct,
    });
  }

  private buildUseCase(): TrainModelsUseCase {
    const checkpointDir = this.parseFlag("--checkpoint");
    const checkpointEveryN = this.parseIntFlag(
      "--checkpoint-every", DEFAULT_CHECKPOINT_EVERY
    );
    return new TrainModelsUseCase({
      marketData: this.container.marketData,
      forecastModel: this.container.forecaster,
      agent: this.container.agent,
      storage: this.container.storage,
      logger: this.container.logger,
      featureBuilder: this.container.featureBuilder,
      checkpoint: checkpointDir
        ? this.container.buildCheckpointManager(checkpointDir)
        : undefined,
      checkpointEveryN,
    });
  }

  private parseFlag(name: string): string | undefined {
    const arg = process.argv.find(a => a.startsWith(`${name}=`));
    return arg ? arg.split("=").slice(1).join("=") : undefined;
  }

  private parseIntFlag(name: string, fallback: number): number {
    const raw = this.parseFlag(name);
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return parsed;
  }
}
