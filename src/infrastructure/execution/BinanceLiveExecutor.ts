import ccxt, { Exchange } from "ccxt";
import { TradeExecutor } from "../../domain/ports/TradeExecutor";
import { Order } from "../../domain/entities/Order";
import { Money } from "../../domain/value-objects/Money";
import { Quantity } from "../../domain/value-objects/Quantity";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { Logger } from "../../domain/ports/Logger";
import { InsufficientBalanceError } from "../../domain/errors/DomainError";

/**
 * Adapter: real Binance (or testnet).
 *
 * WARNING — REAL MONEY: this is the only file that touches real funds.
 * Audits should focus here.
 */
export class BinanceLiveExecutor implements TradeExecutor {
  private readonly exchange: Exchange;
  private readonly useTestnet: boolean;

  constructor(config: BinanceConfig, private readonly logger: Logger) {
    this.useTestnet = config.testnet;
    this.exchange = this.buildExchange(config);
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
    await this.exchange.createMarketBuyOrder(
      order.tradingPair().toString(),
      order.amount().toNumber()
    );
    this.logger.info("BUY confirmed by exchange");
    return order;
  }

  private async executeSell(order: Order): Promise<Order> {
    await this.exchange.createMarketSellOrder(
      order.tradingPair().toString(),
      order.amount().toNumber()
    );
    this.logger.info("SELL confirmed by exchange");
    return order;
  }

  async fetchCashBalance(): Promise<Money> {
    const balance = await this.exchange.fetchBalance();
    const usdt = balance.USDT?.free ?? 0;
    return Money.of(usdt);
  }

  async fetchHoldingQuantity(symbol: TradingSymbol): Promise<Quantity> {
    const base = symbol.toString().split("/")[0];
    const balance = await this.exchange.fetchBalance();
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
