import { Container } from "../Container";
import { Command } from "../Cli";
import { TrainModelsUseCase } from "../../application/use-cases/TrainModelsUseCase";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";

const DEFAULT_CHECKPOINT_EVERY = 5;
// Bumped from 15k → 50k so the from-scratch BiLSTM+Attention has enough
// data per symbol. With 4 forecaster symbols this yields ~200k labeled
// samples — comfortable training territory for a ~150k-param model.
const HISTORICAL_CANDLES = 50_000;
// Forecaster sees BTC + correlated majors. Adding diversity here is the
// "transfer learning" we get without leaving the TF.js stack: same model
// architecture, 4× more data, broader coverage of regime types.
// The first entry is also used as the AGENT symbol; PPO trains only on it.
const FORECASTER_SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT"];

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
    const forecasterSymbols = FORECASTER_SYMBOLS.map(s => TradingSymbol.of(s));
    await useCase.execute({
      agentSymbol: this.container.symbol,
      forecasterSymbols,
      historicalCandles: HISTORICAL_CANDLES,
      windowSize: 64,
      horizon: 4,
      forecastEpochs: 100,
      rlEpisodes: 50,
      forecastModelPath: "./models/bilstm",
      agentPath: "./models/ppo",
      stopLossPct: this.container.environment.stopLossPct,
      takeProfitPct: this.container.environment.takeProfitPct,
      slippagePct: this.container.environment.slippagePct,
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
