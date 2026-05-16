import { TradingCycle } from "../services/TradingCycle";
import { Logger } from "../../domain/ports/Logger";
import { ModelStorage } from "../../domain/ports/ModelStorage";
import { RiskPolicy } from "../../domain/ports/RiskPolicy";
import { TradeExecutor } from "../../domain/ports/TradeExecutor";
import { Money } from "../../domain/value-objects/Money";
import { RiskLimitExceededError } from "../../domain/errors/DomainError";

/**
 * Use Case: 24/7 production with REAL MONEY.
 *
 * Critical guarantees:
 * - Verifies the executor is live before starting
 * - Circuit breaker on drawdown
 * - Graceful shutdown on SIGTERM/SIGINT
 * - Retry with backoff on transient errors
 */
export class InvestUseCase {
  private shouldStop = false;
  private initialCapital: Money = Money.zero();

  constructor(private readonly deps: InvestDependencies) {}

  async execute(input: InvestInput): Promise<void> {
    this.assertLiveExecutor();
    this.registerShutdownHandlers();
    await this.loadModels(input);
    this.initialCapital = await this.deps.executor.fetchCashBalance();
    this.deps.logger.info("=== INVEST MODE started (REAL MONEY) ===", {
      initialCapital: this.initialCapital.toString(),
    });
    await this.runForeverLoop(input);
  }

  private assertLiveExecutor(): void {
    if (!this.deps.executor.isLive()) {
      throw new Error("InvestUseCase requires a live executor, not paper");
    }
  }

  private registerShutdownHandlers(): void {
    process.on("SIGINT", () => this.requestShutdown("SIGINT"));
    process.on("SIGTERM", () => this.requestShutdown("SIGTERM"));
  }

  private requestShutdown(signal: string): void {
    this.deps.logger.warn(`Shutdown requested by ${signal}`);
    this.shouldStop = true;
  }

  private async loadModels(input: InvestInput): Promise<void> {
    await this.deps.storage.loadForecastModel(input.forecastModelPath);
    await this.deps.storage.loadAgent(input.agentPath);
    this.deps.logger.info("Models loaded for production");
  }

  private async runForeverLoop(input: InvestInput): Promise<void> {
    while (!this.shouldStop) {
      await this.runProtectedTick(input);
      await this.wait(input.intervalMs);
    }
    this.deps.logger.info("Loop stopped gracefully");
  }

  private async runProtectedTick(input: InvestInput): Promise<void> {
    try {
      await this.checkCircuitBreaker();
      await this.executeTickWithLogging();
    } catch (error) {
      await this.handleTickError(error, input);
    }
  }

  private async checkCircuitBreaker(): Promise<void> {
    const currentEquity = await this.deps.executor.fetchCashBalance();
    const shouldHalt = this.deps.risk.shouldHaltTrading(
      this.initialCapital, currentEquity
    );
    if (!shouldHalt) return;
    this.shouldStop = true;
    throw new RiskLimitExceededError("Maximum daily drawdown reached");
  }

  private async executeTickWithLogging(): Promise<void> {
    const result = await this.deps.cycle.executeOnce();
    this.deps.logger.info("Tick executed", {
      action: result.action.toString(),
      price: result.price.toString(),
      filled: result.order ? result.order.describe() : "—",
    });
  }

  private async handleTickError(error: unknown, input: InvestInput): Promise<void> {
    if (error instanceof RiskLimitExceededError) {
      this.deps.logger.error("CIRCUIT BREAKER TRIGGERED", { reason: String(error) });
      this.shouldStop = true;
      return;
    }
    this.deps.logger.error("Tick error, retrying", { error: String(error) });
    await this.wait(input.retryDelayMs);
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export interface InvestDependencies {
  cycle: TradingCycle;
  executor: TradeExecutor;
  risk: RiskPolicy;
  storage: ModelStorage;
  logger: Logger;
}

export interface InvestInput {
  forecastModelPath: string;
  agentPath: string;
  intervalMs: number;
  retryDelayMs: number;
}
