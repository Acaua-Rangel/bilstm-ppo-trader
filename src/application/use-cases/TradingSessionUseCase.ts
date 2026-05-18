import { TradingCycle } from "../services/TradingCycle";
import { DailyEquityBaseline } from "../services/DailyEquityBaseline";
import { Clock } from "../../domain/ports/Clock";
import { SessionObserver } from "../../domain/ports/SessionObserver";
import { TradeExecutor } from "../../domain/ports/TradeExecutor";
import { RiskPolicy } from "../../domain/ports/RiskPolicy";
import { ModelStorage } from "../../domain/ports/ModelStorage";
import { Logger } from "../../domain/ports/Logger";
import { MarketDataProvider } from "../../domain/ports/MarketDataProvider";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { Money } from "../../domain/value-objects/Money";
import { Price } from "../../domain/value-objects/Price";
import {
  RiskLimitExceededError,
  ExchangeUnavailableError,
} from "../../domain/errors/DomainError";

/**
 * Use Case: a single trading session.
 *
 * The core loop is identical for TEST and INVEST. Only the injected
 * adapters change:
 *   - Clock: SystemClock (real wall-clock) vs HistoricalClock (replay).
 *   - MarketDataProvider (inside TradingCycle): BinanceMarketData vs HistoricalReplayMarketData.
 *   - TradeExecutor: BinanceLiveExecutor vs PaperExecutor.
 *   - SessionObserver: LiveLogObserver vs BacktestObserver.
 *
 * Guarantees:
 *  - Verifies the executor matches the expected mode (live or paper).
 *  - Circuit breaker on drawdown — measured against a UTC-daily baseline
 *    so the limit resets at 00:00 UTC instead of silently becoming a
 *    session-total limit on long-running deployments.
 *  - ExchangeUnavailableError is fatal: better to halt than to keep
 *    pinging a broken API with capital exposed.
 *  - Graceful shutdown on SIGINT/SIGTERM (cancels the clock so a long sleep aborts).
 *  - Retries with a configurable backoff on transient errors.
 */
export class TradingSessionUseCase {
  private shouldStop = false;
  private initialEquity: Money = Money.zero();
  private dailyBaseline: DailyEquityBaseline | null = null;

  constructor(private readonly deps: SessionDependencies) {}

  async execute(input: SessionInput): Promise<void> {
    this.assertExecutorMode(input.mode);
    this.registerShutdownHandlers();
    await this.loadModels(input);
    this.initialEquity = await this.computeEquity(null);
    this.dailyBaseline = new DailyEquityBaseline(this.initialEquity, new Date());
    this.deps.observer.onSessionStart({ initialEquity: this.initialEquity, mode: input.mode });

    const halted = await this.runLoop(input);

    const finalEquity = await this.computeEquity(null);
    this.deps.observer.onSessionEnd({
      initialEquity: this.initialEquity, finalEquity, halted,
    });
  }

  private async runLoop(input: SessionInput): Promise<boolean> {
    let halted = false;
    while (!this.shouldStop && this.deps.clock.hasNext()) {
      try {
        if (await this.circuitBreakerTripped()) { halted = true; break; }
        await this.runTick();
      } catch (error) {
        const fatal = await this.handleTickError(error, input);
        if (fatal) { halted = true; break; }
      }
      if (!this.shouldStop && this.deps.clock.hasNext()) {
        await this.deps.clock.awaitNext();
      }
    }
    if (this.shouldStop) this.deps.logger.info("Session stopped gracefully");
    return halted;
  }

  private async runTick(): Promise<void> {
    const result = await this.deps.cycle.executeOnce();
    const equity = await this.computeEquity(result.price);
    this.rolloverDailyBaselineIfNeeded(equity);
    this.deps.observer.onTick({
      action: result.action,
      price: result.price,
      order: result.order,
      forecast: result.forecast,
      equity,
    });
  }

  private async circuitBreakerTripped(): Promise<boolean> {
    const equity = await this.computeEquity(null);
    this.rolloverDailyBaselineIfNeeded(equity);
    const baseline = this.dailyBaseline?.current() ?? this.initialEquity;
    if (!this.deps.risk.shouldHaltTrading(baseline, equity)) return false;
    this.deps.logger.error("CIRCUIT BREAKER TRIGGERED (daily drawdown)", {
      dailyBaseline: baseline.toString(),
      currentEquity: equity.toString(),
      utcDay: this.dailyBaseline?.dayKey(),
    });
    this.shouldStop = true;
    this.deps.clock.cancel();
    return true;
  }

  private rolloverDailyBaselineIfNeeded(currentEquity: Money): void {
    if (this.dailyBaseline === null) return;
    if (!this.dailyBaseline.observe(currentEquity, new Date())) return;
    this.deps.logger.info("Daily equity baseline rolled over (UTC)", {
      utcDay: this.dailyBaseline.dayKey(),
      baseline: this.dailyBaseline.current().toString(),
    });
  }

  private async computeEquity(referencePrice: Price | null): Promise<Money> {
    const cash = await this.deps.executor.fetchCashBalance();
    const holding = await this.deps.executor.fetchHoldingQuantity(this.deps.symbol);
    if (holding.isZero()) return cash;
    const price = referencePrice ?? await this.fetchLatestPrice();
    if (price === null) return cash;
    return cash.add(Money.of(holding.toNumber() * price.toNumber()));
  }

  private async fetchLatestPrice(): Promise<Price | null> {
    try {
      const series = await this.deps.marketData.fetchRecentCandles(this.deps.symbol, 1, 0);
      return series.last().closePrice();
    } catch {
      return null;
    }
  }

  private async handleTickError(error: unknown, input: SessionInput): Promise<boolean> {
    if (error instanceof RiskLimitExceededError) {
      this.deps.logger.error("Risk limit exceeded", { reason: String(error) });
      this.shouldStop = true;
      this.deps.clock.cancel();
      return true;
    }
    if (error instanceof ExchangeUnavailableError) {
      this.deps.logger.error("KILL SWITCH — exchange unavailable", { reason: String(error) });
      this.shouldStop = true;
      this.deps.clock.cancel();
      return true;
    }
    this.deps.logger.error("Tick error, retrying", { error: String(error) });
    if (input.retryDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, input.retryDelayMs));
    }
    return false;
  }

  private assertExecutorMode(mode: SessionMode): void {
    const live = this.deps.executor.isLive();
    if (mode === "INVEST" && !live) {
      throw new Error("INVEST mode requires a live executor");
    }
    if (mode === "TEST" && live) {
      throw new Error("TEST mode requires a paper executor (refusing to use real funds)");
    }
  }

  private registerShutdownHandlers(): void {
    process.on("SIGINT", () => this.requestShutdown("SIGINT"));
    process.on("SIGTERM", () => this.requestShutdown("SIGTERM"));
  }

  private requestShutdown(signal: string): void {
    this.deps.logger.warn(`Shutdown requested by ${signal}`);
    this.shouldStop = true;
    this.deps.clock.cancel();
  }

  private async loadModels(input: SessionInput): Promise<void> {
    await this.deps.storage.loadForecastModel(input.forecastModelPath);
    await this.deps.storage.loadAgent(input.agentPath);
    this.deps.logger.info("Models loaded");
  }
}

export type SessionMode = "TEST" | "INVEST";

export interface SessionDependencies {
  cycle: TradingCycle;
  clock: Clock;
  executor: TradeExecutor;
  observer: SessionObserver;
  risk: RiskPolicy;
  storage: ModelStorage;
  logger: Logger;
  symbol: TradingSymbol;
  marketData: MarketDataProvider;
}

export interface SessionInput {
  forecastModelPath: string;
  agentPath: string;
  retryDelayMs: number;
  mode: SessionMode;
}
