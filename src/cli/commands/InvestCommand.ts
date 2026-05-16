import { Container } from "../Container";
import { Command } from "../Cli";
import { InvestUseCase } from "../../application/use-cases/InvestUseCase";

/**
 * CLI command: INVEST mode.
 *
 * WARNING — APPLIES REAL MONEY.
 * Prints an explicit confirmation banner before starting.
 */
export class InvestCommand implements Command {
  constructor(private readonly container: Container) {}

  async execute(): Promise<void> {
    this.printWarning();
    const executor = this.container.buildLiveExecutor();
    const cycle = this.container.buildTradingCycle(executor);
    const useCase = new InvestUseCase({
      cycle, executor,
      risk: this.container.risk,
      storage: this.container.storage,
      logger: this.container.logger,
    });
    await useCase.execute({
      forecastModelPath: "./models/bilstm",
      agentPath: "./models/ppo",
      intervalMs: 60 * 60 * 1000,
      retryDelayMs: 30_000,
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
