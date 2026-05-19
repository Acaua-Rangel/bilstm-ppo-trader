import ccxt, { Exchange } from "ccxt";
import { TradeExecutor } from "../../domain/ports/TradeExecutor";
import { Order } from "../../domain/entities/Order";
import { Money } from "../../domain/value-objects/Money";
import { Quantity } from "../../domain/value-objects/Quantity";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { Logger } from "../../domain/ports/Logger";
import { InsufficientBalanceError } from "../../domain/errors/DomainError";
import { ExchangeRetry } from "./ExchangeRetry";

/**
 * Adapter: real Binance (or testnet).
 *
 * WARNING — REAL MONEY: this is the only file that touches real funds.
 * Audits should focus here.
 *
 * Every outbound call is wrapped in ExchangeRetry so 418/429 throttling
 * and transient 5xx errors back off exponentially instead of failing the
 * tick. When the retry budget is blown the wrapper raises
 * ExchangeUnavailableError, which the session use case treats as fatal
 * and halts the bot — safer than retrying blindly with an open position.
 */
export class BinanceLiveExecutor implements TradeExecutor {
  private readonly exchange: Exchange;
  private readonly useTestnet: boolean;
  private readonly retry: ExchangeRetry;

  constructor(config: BinanceConfig, private readonly logger: Logger) {
    this.useTestnet = config.testnet;
    this.exchange = this.buildExchange(config);
    this.retry = new ExchangeRetry({
      maxAttempts: 5,
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
    }, logger);
  }

  private buildExchange(config: BinanceConfig): Exchange {
    const exchange = new ccxt.binance({
      apiKey: config.apiKey,
      secret: config.apiSecret,
      enableRateLimit: true,
      options: { defaultType: "spot" },
    });
    if (this.useTestnet) exchange.setSandboxMode(true);
    return exchange;
  }

  async submit(order: Order): Promise<Order> {
    this.logSubmission(order);
    if (order.side().isBuy()) return await this.executeBuy(order);
    if (order.side().isSell()) return await this.executeSell(order);
    return order;
  }

  private logSubmission(order: Order): void {
    this.logger.info(`Submitting REAL order: ${order.describe()}`, {
      testnet: this.useTestnet,
    });
  }

  private async executeBuy(order: Order): Promise<Order> {
    const cash = await this.fetchCashBalance();
    const requiredCash = Money.of(
      order.amount().toNumber() * order.priceAtExecution().toNumber()
    );
    if (requiredCash.isGreaterThan(cash)) throw new InsufficientBalanceError();
    await this.retry.execute("createMarketBuyOrder", () =>
      this.exchange.createMarketBuyOrder(
        order.tradingPair().toString(),
        order.amount().toNumber()
      )
    );
    this.logger.info("BUY confirmed by exchange");
    return order;
  }

  private async executeSell(order: Order): Promise<Order> {
    await this.retry.execute("createMarketSellOrder", () =>
      this.exchange.createMarketSellOrder(
        order.tradingPair().toString(),
        order.amount().toNumber()
      )
    );
    this.logger.info("SELL confirmed by exchange");
    return order;
  }

  async fetchCashBalance(): Promise<Money> {
    const balance = await this.retry.execute("fetchBalance", () => this.exchange.fetchBalance());
    const usdt = balance.FDUSD?.free ?? 0;
    return Money.of(usdt);
  }

  async fetchHoldingQuantity(symbol: TradingSymbol): Promise<Quantity> {
    const base = symbol.toString().split("/")[0];
    const balance = await this.retry.execute("fetchBalance", () => this.exchange.fetchBalance());
    const amount = balance[base]?.free ?? 0;
    return Quantity.of(amount);
  }

  isLive(): boolean {
    return !this.useTestnet;
  }
}

export interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
}
