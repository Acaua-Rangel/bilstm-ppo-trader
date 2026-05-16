import { TradeExecutor } from "../../domain/ports/TradeExecutor";
import { Order } from "../../domain/entities/Order";
import { Money } from "../../domain/value-objects/Money";
import { Quantity } from "../../domain/value-objects/Quantity";
import { TradingSymbol } from "../../domain/value-objects/TradingSymbol";
import { Logger } from "../../domain/ports/Logger";

/**
 * Adapter: simulation. Does not touch the real exchange.
 * Used in TEST mode. LSP-compatible with real executors.
 */
export class PaperExecutor implements TradeExecutor {
  private cash: Money;
  private holding: Quantity = Quantity.zero();
  private readonly fee: number = 0.001;

  constructor(initialCash: Money, private readonly logger: Logger) {
    this.cash = initialCash;
  }

  async submit(order: Order): Promise<Order> {
    if (order.side().isBuy()) return this.simulateBuy(order);
    if (order.side().isSell()) return this.simulateSell(order);
    return order;
  }

  private simulateBuy(order: Order): Order {
    const cost = order.amount().toNumber() * order.priceAtExecution().toNumber();
    const totalCost = cost * (1 + this.fee);
    if (totalCost > this.cash.toNumber()) {
      this.logger.warn("Paper: insufficient balance, ignoring order");
      return order;
    }
    this.cash = this.cash.subtract(Money.of(totalCost));
    this.holding = Quantity.of(this.holding.toNumber() + order.amount().toNumber());
    this.logger.info(`[PAPER BUY] cash=${this.cash.toString()} holding=${this.holding.toString()}`);
    return order;
  }

  private simulateSell(order: Order): Order {
    if (order.amount().toNumber() > this.holding.toNumber()) {
      this.logger.warn("Paper: insufficient holding");
      return order;
    }
    const revenue = order.amount().toNumber() * order.priceAtExecution().toNumber();
    const netRevenue = revenue * (1 - this.fee);
    this.cash = this.cash.add(Money.of(netRevenue));
    this.holding = Quantity.of(this.holding.toNumber() - order.amount().toNumber());
    this.logger.info(`[PAPER SELL] cash=${this.cash.toString()} holding=${this.holding.toString()}`);
    return order;
  }

  async fetchCashBalance(): Promise<Money> {
    return this.cash;
  }

  async fetchHoldingQuantity(_symbol: TradingSymbol): Promise<Quantity> {
    return this.holding;
  }

  isLive(): boolean {
    return false;
  }
}
